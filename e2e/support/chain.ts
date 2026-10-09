/**
 * Pure-function chain logic for the mock JSON-RPC layer:
 *  - `handleEthCall`  decodes an eth_call (incl. Multicall3 aggregate3 batches)
 *    and returns ABI-encoded result hex, computed from the MockWorld.
 *  - `applyWrite`     decodes an eth_sendTransaction's calldata (incl. forwarder
 *    aggregate3 batches), mutates the MockWorld, and returns receipt logs.
 *
 * Everything is encoded/decoded with viem so the shapes match what the SDK
 * (also viem-based) expects to parse back.
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeEventTopics,
  type AbiFunction,
  type Hex,
  stringToHex,
  toFunctionSelector,
} from "viem";

import {
  perpsMarketProxyAbi,
  trustedMulticallForwarderAbi,
} from "@liq/sdk";

import { classify, combinedAbi } from "./contracts";
import { WAD } from "./constants";
import { findAccount, type MockWorld, type ReceiptLog } from "./world";

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Bring a collateral amountDelta to 18 decimals. A 6-dec amount (e.g. USDC
 * 200_000000) is below 1e12 for realistic test sizes and gets scaled up; an
 * already-18-dec amount (e.g. 200e18) is far above 1e12 and is left as-is.
 */
function normaliseToWad(delta: bigint): bigint {
  const abs = delta < 0n ? -delta : delta;
  if (abs === 0n) return 0n;
  return abs < 10n ** 12n ? delta * 10n ** 12n : delta;
}

// selector -> abi function item, for every read/write function the SDK uses.
const REGISTRY = new Map<string, AbiFunction>();
for (const item of combinedAbi) {
  if (item.type === "function") {
    REGISTRY.set(toFunctionSelector(item), item as AbiFunction);
  }
}
/** У Multicall3 и у форвардера `aggregate3` одной сигнатуры — значит, и селектор один. */
const AGGREGATE3 = trustedMulticallForwarderAbi[0] as AbiFunction;
const AGGREGATE3_SELECTOR = toFunctionSelector(AGGREGATE3);

/** Selector of the collateral write — used to mark a reverting deposit/withdraw. */
const MODIFY_COLLATERAL_SELECTOR = toFunctionSelector(
  combinedAbi.find(
    (i) => i.type === "function" && i.name === "modifyCollateral",
  ) as AbiFunction,
);

/** Selector of the enable-book write — lets specs assert it was (or wasn't) sent. */
export const SET_BOOK_MODE_SELECTOR = toFunctionSelector(
  combinedAbi.find(
    (i) => i.type === "function" && i.name === "setBookMode",
  ) as AbiFunction,
);

/** Selectors the hold-barriers match on: the account-list and positions reads. */
export const TOKEN_OF_OWNER_SELECTOR = toFunctionSelector(
  combinedAbi.find(
    (i) => i.type === "function" && i.name === "tokenOfOwnerByIndex",
  ) as AbiFunction,
);
/** The read `useEnrichedPositions` (0.42+) actually fires — see mockChain's hold. */
export const GET_ACCOUNT_FULL_POSITION_INFO_SELECTOR = toFunctionSelector(
  combinedAbi.find(
    (i) => i.type === "function" && i.name === "getAccountFullPositionInfo",
  ) as AbiFunction,
);

function selectorOf(data: string): string {
  return data.slice(0, 10);
}
function bodyOf(data: string): Hex {
  return ("0x" + data.slice(10)) as Hex;
}

/** Result of a single decoded call (for aggregate3 fan-out). */
interface CallResult {
  success: boolean;
  returnData: Hex;
}

/**
 * Encode the ABI result of one eth_call against the world. Throws to signal a
 * revert (caller turns that into a failed multicall entry / JSON-RPC error).
 */
function encodeSingleCall(world: MockWorld, to: string, data: string): Hex {
  const selector = selectorOf(data);
  const item = REGISTRY.get(selector);
  if (!item) throw new Error(`unhandled selector ${selector} on ${to}`);

  const args =
    item.inputs.length > 0
      ? (decodeAbiParameters(item.inputs, bodyOf(data)) as readonly unknown[])
      : [];
  const result = computeRead(world, to, item.name, args);
  return encodeAbiParameters(item.outputs, result) as Hex;
}

/** Compute the (array of) output values for a read. */
function computeRead(
  world: MockWorld,
  to: string,
  name: string,
  args: readonly unknown[],
): unknown[] {
  const logical = classify(to);
  switch (name) {
    case "balanceOf": {
      if (logical === "PerpsAccountProxy") {
        return [BigInt(world.accounts.length)];
      }
      // ERC-20 token balance — plenty for deposit flows. Honour the token's
      // real decimals: USDC (what a deposit actually spends) is 6-dec, sUSDC
      // and the rest are 18-dec. A flat 18-dec value for USDC would let the
      // dialog's 6-dec→WAD lift overstate the balance by 10^12.
      return [
        logical === "USDC"
          ? (world.walletUsdc ?? 1_000_000n * 10n ** 6n)
          : 1_000_000n * 10n ** 18n,
      ];
    }
    case "tokenOfOwnerByIndex": {
      const index = Number(args[1]);
      const account = world.accounts[index];
      if (!account) throw new Error("token index out of range");
      return [account.id];
    }
    case "getAvailableMargin": {
      const account = findAccount(world, args[0] as bigint);
      return [account?.available ?? 0n];
    }
    case "getWithdrawableMargin": {
      const account = findAccount(world, args[0] as bigint);
      return [account?.withdrawable ?? 0n];
    }
    case "getCollateralAmount": {
      // Мир держит одну корзину маржи на аккаунт, не по коллатералам: любой
      // id отвечает всем available, и потолок по токену совпадает с маржой.
      const held = findAccount(world, args[0] as bigint)?.available ?? 0n;
      return [held > 0n ? held : 0n];
    }
    case "debt": {
      const account = findAccount(world, args[0] as bigint);
      return [account?.debt ?? 0n];
    }
    case "getOrderMode": {
      const account = findAccount(world, args[0] as bigint);
      const mode = account?.orderMode ?? "ONCHAIN";
      return [stringToHex(mode, { size: 16 })];
    }
    case "canLiquidate": {
      return [false];
    }
    // Replaces the per-market getOpenPosition loop as of SDK 0.42's
    // useEnrichedPositions: one call returns every open (nonzero-size)
    // position, each carrying its own entryPrice (no longer derived
    // client-side from indexPrice/pnl — see @liqpro/liq-onchain's
    // toFullPositionInfo). The mock still HAS to derive it here from the
    // fixture's totalPnl/accruedFunding/positionSize, using the same
    // formula @liqpro/liq-onchain's deriveEntryPrice uses, since
    // PositionFixture stores pnl+size, not a stored entry price.
    case "getAccountFullPositionInfo": {
      const account = findAccount(world, args[0] as bigint);
      const rows = (account?.positions ?? [])
        .filter((p) => p.positionSize !== 0n)
        .map((p) => {
          const market = world.markets.find((m) => m.id === p.marketId);
          const pricePnl = p.totalPnl - p.accruedFunding;
          const entryPrice =
            world.indexPrice - (pricePnl * WAD) / p.positionSize;
          return {
            marketId: BigInt(p.marketId),
            size: p.positionSize,
            pnl: p.totalPnl,
            accruedFunding: p.accruedFunding,
            chargedInterest: 0n,
            currentPrice: world.indexPrice,
            entryPrice,
            requiredInitialMargin: 0n,
            requiredMaintenanceMargin: 0n,
            marketName: market?.symbol ?? "",
            marketSymbol: market?.symbol ?? "",
          };
        });
      return [rows];
    }
    // Account-level margins paired with the position read above in the same
    // multicall (getAccountPositionSnapshot). No fixture models per-account
    // required margins yet, so 0 for all three — safe: accountMargin()'s
    // ratio()/leverageFor()/liquidationPriceFor() all guard the zero case
    // (see @liqpro/liq-core's accountMargin) rather than dividing by it.
    case "getRequiredMargins": {
      const account = findAccount(world, args[0] as bigint);
      return [account?.requiredInitialMargin ?? 0n, 0n, 0n];
    }
    // Превью ордера (`getOrderMarginPreview` в @liqpro/liq-onchain 0.67): одна
    // мультиколла из шести чтений — requiredMarginForOrderWithPrice,
    // getAvailableMargin, getRequiredMargins, getAccountFullPositionInfo (все
    // четыре выше или ниже по списку), getLiquidationParameters и
    // getFundingParameters. Падение первого — ошибка превью, остальных — только
    // «уровня ликвидации нет», поэтому мок отвечает всеми шестью.
    //
    // R1 = R0 + (|размер после| − |размер до|) · цена · доля — требование
    // всего аккаунта после ордера, где цена — четвёртый аргумент чтения (цена
    // превью, которую выбрало приложение), а не `indexPrice` мира: иначе тест
    // не отличил бы превью по введённой цене от превью по марку; по сокращающему ордеру оно падает, и
    // шлюз блокирует `max(0, R1 − R0)`.
    case "requiredMarginForOrderWithPrice": {
      world.orderMarginReads += 1;
      world.orderMarginCalls.push({
        marketId: String(args[1]),
        price: args[3] as bigint,
      });
      if (world.faults.orderMarginFails) throw new Error("preview reverts");
      const account = findAccount(world, args[0] as bigint);
      const delta = args[2] as bigint;
      const held =
        account?.positions.find((p) => p.marketId === String(args[1]))
          ?.positionSize ?? 0n;
      const absOf = (n: bigint) => (n < 0n ? -n : n);
      const grown = absOf(held + delta) - absOf(held);
      const required =
        (account?.requiredInitialMargin ?? 0n) +
        (grown * (args[3] as bigint) * world.orderMarginRatio) / (WAD * WAD);
      return [required > 0n ? required : 0n];
    }
    // initialMarginRatio 0 и скью-масштаб 0 — доля не зависит от размера:
    // начальная = `orderMarginRatio`, поддержка = половина её. Награда
    // ликвидатора и минимум позиции — ноль.
    case "getLiquidationParameters": {
      return [0n, world.orderMarginRatio, WAD / 2n, 0n, 0n];
    }
    case "getFundingParameters": {
      return [0n, 0n];
    }
    case "getOpenPosition": {
      const account = findAccount(world, args[0] as bigint);
      const marketId = (args[1] as bigint).toString();
      const pos = account?.positions.find((p) => p.marketId === marketId);
      // Четвёртый выход — owedInterest; мир процент не моделирует.
      if (!pos) return [0n, 0n, 0n, 0n];
      return [pos.totalPnl, pos.accruedFunding, pos.positionSize, 0n];
    }
    case "indexPrice": {
      return [world.indexPrice];
    }
    case "getOrderFees": {
      return [world.orderFees.maker, world.orderFees.taker];
    }
    case "skew": {
      return [world.skew];
    }
    case "fillPrice": {
      // Fill == the caller-supplied price: a flat book with zero impact, so
      // preview assertions stay arithmetic (fee/notional) not market-model.
      // args[2] is `price` per the ABI [marketId, orderSize, price] — if an
      // SDK upgrade reorders the call, fix the index here.
      return [args[2] as bigint];
    }
    case "getSettlementRewardCost": {
      return [0n];
    }
    case "allowance": {
      return [MAX_UINT256];
    }
    default:
      throw new Error(`no read handler for ${name}`);
  }
}

/** Handle an eth_call (single or Multicall3 aggregate3). Returns result hex. */
export function handleEthCall(world: MockWorld, to: string, data: string): Hex {
  if (selectorOf(data) === AGGREGATE3_SELECTOR) {
    const [calls] = decodeAbiParameters(
      AGGREGATE3.inputs,
      bodyOf(data),
    ) as unknown as [ReadonlyArray<{ target: string; callData: Hex }>];
    const results: CallResult[] = calls.map((call) => {
      try {
        return {
          success: true,
          returnData: encodeSingleCall(world, call.target, call.callData),
        };
      } catch {
        return { success: false, returnData: "0x" };
      }
    });
    return encodeAbiParameters(AGGREGATE3.outputs, [results]) as Hex;
  }
  return encodeSingleCall(world, to, data);
}

/**
 * Apply a write (eth_sendTransaction calldata) to the world. Recurses into
 * forwarder aggregate3 batches. Returns receipt logs (e.g. AccountCreated).
 */
/**
 * Снимает ли эта запись коллатерал — прямой `modifyCollateral` с отрицательной
 * дельтой или форвардерный `aggregate3`, внутри которого он есть. Депозит тоже
 * идёт батчем через форвардер, но с положительной дельтой, и сюда не попадает.
 */
export function withdrawsCollateral(data: string): boolean {
  const selector = selectorOf(data);
  if (selector === AGGREGATE3_SELECTOR) {
    const [calls] = decodeAbiParameters(
      AGGREGATE3.inputs,
      bodyOf(data),
    ) as unknown as [ReadonlyArray<{ callData: Hex }>];
    return calls.some((call) => withdrawsCollateral(call.callData));
  }
  if (selector !== MODIFY_COLLATERAL_SELECTOR) return false;
  const item = REGISTRY.get(selector)!;
  const args = decodeAbiParameters(item.inputs, bodyOf(data)) as readonly unknown[];
  return (args[2] as bigint) < 0n;
}

export function applyWrite(
  world: MockWorld,
  to: string,
  data: string,
): ReceiptLog[] {
  const selector = selectorOf(data);

  if (selector === AGGREGATE3_SELECTOR) {
    const [calls] = decodeAbiParameters(
      AGGREGATE3.inputs,
      bodyOf(data),
    ) as unknown as [ReadonlyArray<{ target: string; callData: Hex }>];
    return calls.flatMap((call) =>
      applyWrite(world, call.target, call.callData),
    );
  }

  const item = REGISTRY.get(selector);
  if (!item) return []; // unknown write (e.g. approve variants) — no-op success
  const args =
    item.inputs.length > 0
      ? (decodeAbiParameters(item.inputs, bodyOf(data)) as readonly unknown[])
      : [];

  switch (item.name) {
    case "createAccount": {
      const requestedId = args[0] as bigint | undefined;
      const id = requestedId ?? world.accountCounter++;
      world.accounts.push({
        id,
        orderMode: "ONCHAIN",
        available: 0n,
        withdrawable: 0n,
        positions: [],
      });
      const topics = encodeEventTopics({
        abi: perpsMarketProxyAbi,
        eventName: "AccountCreated",
        args: { accountId: id, owner: world.wallet as Hex },
      });
      return [{ address: to, topics, data: "0x" }];
    }
    case "setBookMode": {
      const account = findAccount(world, args[0] as bigint);
      if (account)
        account.orderMode = (args[1] as boolean) ? "BOOK" : "ONCHAIN";
      return [];
    }
    case "modifyCollateral": {
      // A reverting tx changes no state — the mock chain returns a 0x0 receipt
      // (see mockChain.buildReceipt) and the SDK surfaces it as a tx error.
      if (world.faults.collateralReverts) return [];
      const account = findAccount(world, args[0] as bigint);
      world.lastCollateralId = args[1] as bigint;
      const amountDelta = args[2] as bigint;
      world.lastCollateralDelta = amountDelta;
      if (account) {
        // Normalise to 18-dec so the displayed margin reflects the real amount
        // regardless of the collateral token's decimals (6-dec USDC vs 18-dec).
        const wad = normaliseToWad(amountDelta);
        const next = account.available + wad;
        account.available = next < 0n ? 0n : next;
        account.withdrawable = account.available;
      }
      return [];
    }
    default:
      return [];
  }
}
