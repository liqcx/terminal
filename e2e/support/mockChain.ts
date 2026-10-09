/**
 * Mock JSON-RPC endpoint. Intercepts every request to the RPC origin and
 * answers from the MockWorld: eth_call reads via {@link handleEthCall}, receipts
 * for sent txs, and the housekeeping methods viem issues around a write.
 */
import type { Page } from "@playwright/test";
import { numberToHex } from "viem";

import {
  handleEthCall,
  TOKEN_OF_OWNER_SELECTOR,
  GET_ACCOUNT_FULL_POSITION_INFO_SELECTOR,
  REQUIRED_MARGIN_FOR_ORDER_SELECTOR,
  withdrawsCollateral,
} from "./chain";
import type { MockWorld } from "./world";

const ZERO_HASH = "0x" + "00".repeat(32);
const LOGS_BLOOM = "0x" + "00".repeat(256);

interface RpcMessage {
  id: number | string;
  method: string;
  params: unknown[];
}

class RpcRevert extends Error {}

function buildReceipt(world: MockWorld, hash: string) {
  const tx = world.sentTxs.find((t) => t.hash === hash);
  // collateralReverts flags a reverted receipt only for a tx that WITHDRAWS
  // collateral — a direct modifyCollateral with a negative delta, or the
  // forwarder aggregate3 batch the withdraw dialog sends (withdraw + unwrap).
  // The deposit batch also carries modifyCollateral, but with a positive
  // delta, so its receipt stays successful; the SDK never raises a
  // deposit-error (monorepo#434).
  const reverted =
    !!world.faults.collateralReverts && !!tx && withdrawsCollateral(tx.data);
  const logs = (world.receipts[hash] ?? []).map((log, i) => ({
    ...log,
    blockHash: ZERO_HASH,
    blockNumber: numberToHex(world.blockNumber),
    transactionHash: hash,
    transactionIndex: "0x0",
    logIndex: numberToHex(i),
    removed: false,
  }));
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: ZERO_HASH,
    blockNumber: numberToHex(world.blockNumber),
    from: world.wallet.toLowerCase(),
    to: tx?.to ?? null,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logs,
    logsBloom: LOGS_BLOOM,
    status: reverted ? "0x0" : "0x1",
    type: "0x2",
    effectiveGasPrice: "0x3b9aca00",
  };
}

function buildBlock(world: MockWorld) {
  return {
    number: numberToHex(world.blockNumber),
    hash: ZERO_HASH,
    parentHash: ZERO_HASH,
    nonce: "0x0000000000000000",
    sha3Uncles: ZERO_HASH,
    logsBloom: LOGS_BLOOM,
    transactionsRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    receiptsRoot: ZERO_HASH,
    miner: "0x" + "00".repeat(20),
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: "0x66400000",
    baseFeePerGas: "0x3b9aca00",
    transactions: [],
    uncles: [],
    mixHash: ZERO_HASH,
  };
}

function dispatch(
  world: MockWorld,
  method: string,
  params: unknown[],
): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x18c7";
    case "net_version":
      return "6343";
    case "eth_blockNumber": {
      const n = numberToHex(world.blockNumber);
      world.blockNumber += 1n; // advance so block watchers make progress
      return n;
    }
    case "eth_call": {
      const tx = (params[0] ?? {}) as { to?: string; data?: string };
      try {
        return handleEthCall(
          world,
          (tx.to ?? "").toLowerCase(),
          tx.data ?? "0x",
        );
      } catch (err) {
        throw new RpcRevert(
          err instanceof Error ? err.message : "execution reverted",
        );
      }
    }
    case "eth_getTransactionReceipt": {
      const hash = params[0] as string;
      return world.receipts[hash] !== undefined
        ? buildReceipt(world, hash)
        : null;
    }
    case "eth_getTransactionByHash": {
      const hash = params[0] as string;
      if (world.receipts[hash] === undefined) return null;
      return {
        hash,
        nonce: "0x0",
        blockHash: ZERO_HASH,
        blockNumber: numberToHex(world.blockNumber),
        transactionIndex: "0x0",
        from: world.wallet.toLowerCase(),
        to: world.sentTxs.find((t) => t.hash === hash)?.to ?? null,
        value: "0x0",
        gas: "0x5208",
        gasPrice: "0x3b9aca00",
        input: "0x",
        type: "0x2",
        chainId: "0x18c7",
      };
    }
    case "eth_getBlockByNumber":
    case "eth_getBlockByHash":
      return buildBlock(world);
    case "eth_getBalance":
      return "0x56bc75e2d63100000"; // 100 ETH
    case "eth_getTransactionCount":
      return "0x0";
    case "eth_getCode":
      // An EOA with no delegate: a real node answers "0x" here, and the relay
      // reads this to decide whether the batch still needs an EIP-7702
      // authorization (ADR-0063).
      return "0x";
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return "0x3b9aca00";
    case "eth_estimateGas":
      return "0x5208";
    case "eth_feeHistory":
      return {
        oldestBlock: numberToHex(world.blockNumber),
        baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
        gasUsedRatio: [0.5],
        reward: [["0x3b9aca00"]],
      };
    case "web3_clientVersion":
      return "e2e-mock/1.0";
    default:
      // Most reads the app never makes; null keeps viem from hard-crashing.
      return null;
  }
}

/**
 * Await any armed hold-barrier matching this RPC message before replying.
 * Selector matching is substring-based so it fires even when the read is nested
 * in a Multicall3 aggregate3 batch (the inner selector appears in the calldata).
 */
async function awaitHolds(world: MockWorld, msg: RpcMessage): Promise<void> {
  if (msg.method === "eth_getTransactionReceipt") {
    await world.holds.collateralReceipt?.promise;
    return;
  }
  if (msg.method === "eth_call") {
    const data = String((msg.params?.[0] as { data?: string })?.data ?? "");
    if (
      world.holds.accountRead &&
      data.includes(TOKEN_OF_OWNER_SELECTOR.slice(2))
    ) {
      await world.holds.accountRead.promise;
    }
    if (
      world.holds.positionsRead &&
      data.includes(GET_ACCOUNT_FULL_POSITION_INFO_SELECTOR.slice(2))
    ) {
      await world.holds.positionsRead.promise;
    }
    if (
      world.holds.orderMarginRead &&
      data.includes(REQUIRED_MARGIN_FOR_ORDER_SELECTOR.slice(2))
    ) {
      await world.holds.orderMarginRead.promise;
    }
  }
}

export async function mockChain(page: Page, world: MockWorld): Promise<void> {
  await page.route(/rpc\.e2e\.local/, async (route) => {
    const raw = route.request().postData() ?? "{}";
    const parsed = JSON.parse(raw) as RpcMessage | RpcMessage[];
    for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
      await awaitHolds(world, msg);
    }
    const handleOne = (msg: RpcMessage) => {
      try {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: dispatch(world, msg.method, msg.params ?? []),
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: err instanceof RpcRevert ? 3 : -32000,
            message: err instanceof Error ? err.message : "error",
            data: "0x",
          },
        };
      }
    };
    const body = Array.isArray(parsed)
      ? parsed.map(handleOne)
      : handleOne(parsed);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
