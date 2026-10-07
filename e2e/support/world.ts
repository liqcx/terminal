/**
 * MockWorld — the single mutable source of truth a hermetic test drives.
 *
 * Every interceptor (mock chain, mock gateway, injected wallet) closes over the
 * same instance, so a write through the wallet (e.g. createAccount) mutates the
 * state that subsequent reads (accounts.list) and gateway responses observe —
 * exactly like a real backend, but deterministic and in-process.
 */
import type {
  GatewayOrder as CoreGatewayOrder,
  OrderStatus,
  OrderType,
  Side,
} from "@liq/core";
import { parseUnits } from "viem";

import { CHAIN_ID, MARKET, type Market, TEST_ADDRESS, WAD } from "./constants";

type OrderMode = "BOOK" | "ONCHAIN" | "RECENTLY_CHANGED";

export interface PositionFixture {
  marketId: string;
  /** int256, 18-dec */
  totalPnl: bigint;
  /** int256, 18-dec */
  accruedFunding: bigint;
  /** int128, signed 18-dec (positive long, negative short) */
  positionSize: bigint;
}

interface AccountFixture {
  id: bigint;
  orderMode: OrderMode;
  /** getAvailableMargin (int256, 18-dec) */
  available: bigint;
  /** getWithdrawableMargin (int256, 18-dec) */
  withdrawable: bigint;
  /** Outstanding Synthetix debt (uint256, 18-dec). Defaults to 0 (debt-free). */
  debt?: bigint;
  positions: PositionFixture[];
}

/**
 * Ордер шлюза — форма из SDK, чтобы копия не разошлась с ней молча (так тут
 * завёлся статус `REJECTED`, которого у шлюза нет).
 *
 * Три поля перечислений развёрнуты в строковые литералы (`${Enum}`): enum'ы в
 * TS номинальные, и без этого каждая фикстура писала бы `OrderStatus.PENDING`
 * вместо `"PENDING"`. Набор значений всё равно задаёт SDK.
 */
export type GatewayOrder = Omit<
  CoreGatewayOrder,
  "side" | "orderType" | "status"
> & {
  side: `${Side}`;
  orderType: `${OrderType}`;
  status: `${OrderStatus}`;
};

interface TradeRow {
  id: string;
  timestamp: number;
  marketId: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  takerAccountId: string;
  makerAccountId: string;
  takerOrderId: string;
  makerOrderId: string;
  txHash: string;
}

/** Провод `GET /accounts/:id/position-history` — числа строками, как у шлюза. */
interface WirePositionEpisode {
  marketId: string;
  symbol: string | null;
  direction: "long" | "short";
  /** unix SECONDS */
  openedAt: number;
  closedAt: number;
  avgEntryPrice: string;
  avgClosePrice: string | null;
  maxSize: string;
  realizedPnl: string | null;
  feesUsd: string | null;
  closedBy: "trade" | "liquidation";
  liquidationPrice: null;
  openInferred: boolean;
  liquidationTouched: boolean;
  sizeDiverged: boolean;
}

/** Провод `GET /accounts/:id/settlement-ledger`. */
interface WireLedgerRow {
  timestampMs: number;
  txHash: string;
  logIndex: number;
  marketId: string;
  kind: "settlement" | "liquidation";
  sizeDelta: string | null;
  newSize: string | null;
  fillPrice: string | null;
  pricePnl: string | null;
  accruedFunding: string | null;
  interest: string | null;
  totalFees: string | null;
  netBalanceDelta: string | null;
  liquidationTouched: boolean;
}

/** Ответ `GET /accounts/:id/portfolio` без полей, которые мок дописывает сам. */
export interface WirePortfolio {
  available: boolean;
  points: Array<{
    timestamp: number;
    equityUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    netDepositsUsd: number;
  }>;
  summary: {
    realizedPnlUsd: number;
    fundingUsd: number;
    feesUsd: number;
    volumeUsd: number;
    netDepositsUsd: number;
    maxDrawdownPct: number | null;
    estimated: boolean;
  };
  collateralEvents: Array<{
    timestamp: number;
    amountUsd: number;
    type: "deposit" | "withdrawal";
    collateralId: string;
  }>;
}

interface RecordedTx {
  hash: string;
  to: string;
  data: string;
  kind: string;
}

/**
 * A job of the gasless relay (ADR-0063), as `GET /relay/:jobId` reports it.
 *
 * @remarks
 * The mock gateway plays the relayer: it applies the signed batch to the world
 * and hands back a hash the app then waits a receipt for, exactly as the real
 * worker does.
 */
export interface RelayJob {
  state: "completed" | "failed";
  txHash?: string;
  gasUsed?: string;
  status?: "success" | "reverted";
  error?: string;
}

/** Динамическая часть строки `/markets/full`. */
interface WireMarketDynamic {
  openInterest: string | null;
  currentFundingRate: string | null;
  indexPrice: string | null;
}

/** Окно объёма за сутки, как его отдаёт шлюз. */
interface WireVolumeWindow {
  volumeUsd: string;
  volumeBase: string;
  trades: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * Маршруты шлюза, у которых спека умеет отобрать ответ статусом. Ключ читается
 * в `mockGateway.ts` ровно там, где стоял прежний `if (faults.xStatus)` — место
 * проверки семантично (барьер `holds`, метод, побочный счётчик), поэтому в
 * диспетчер её не поднять, не заведя вторую копию маршрутизации.
 */
export type FaultRoute =
  | "authVerify"
  | "candles"
  | "cancel"
  | "funding"
  | "markets"
  | "orderbook"
  | "orders"
  | "portfolio"
  | "price"
  | "submitOrder"
  | "trades";

export interface MockWorld {
  wallet: string;
  /** Chain the injected wallet reports (eth_chainId / net_version); mutable —
   * wallet_switchEthereumChain rewrites it and emits chainChanged. */
  chainId: number;
  accounts: AccountFixture[];
  /**
   * USDC в кошельке — сырой, 6 знаков. Нет — миллион: депозиту хватает на
   * всё. Задаётся, чтобы проверить гейт погашения долга (TRM-29).
   */
  walletUsdc?: bigint;
  /** index price (onchain indexPrice + entry-price math), 18-dec */
  indexPrice: bigint;
  /** gateway mark price (GET /markets/:id/price), 18-dec */
  price: bigint;
  /** getOrderFees read — WAD fee ratios (default 2bp maker / 6bp taker). */
  orderFees: { maker: bigint; taker: bigint };
  /** Market skew read — positive by default so a BUY previews as the taker side. */
  skew: bigint;
  markets: Market[];
  funding: {
    // The SDK's getFunding() treats a missing/false `available` as "no
    // snapshot" and returns nulled UNAVAILABLE_FUNDING regardless of the
    // other fields (a gateway <0.34.0 sent none, and its numbers weren't a
    // real measurement) — so the mock has to send `true` for a scenario's
    // funding fields to actually reach the UI. See @liqpro/liq-api-client's
    // MarketsService.getFunding.
    available: true;
    rate: string;
    velocity: string;
    index: string;
    predicted1h: string;
    predicted8h: string;
    updatedAt: string;
  };
  candles: Array<{
    timestamp: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    tradeCount: number;
    lastTradePrice: string | null;
  }>;
  /** Per-market candle override; the /candles route falls back to `candles`. */
  candlesByMarket?: Record<string, MockWorld["candles"]>;
  /**
   * Оракульные бары по id рынка; маршрут падает на общий рамп из `price`.
   *
   * @remarks Отдельно от `candles`, потому что маршруты разные и смысл разный:
   * оракульный ряд непрерывен по построению, торговый молчит там, где не
   * торговали.
   */
  oracleCandles: Record<string, MockWorld["candles"]>;
  /**
   * Динамика рынка — то, что шлюз кладёт в `dynamic` строки `/markets/full`.
   * Отсутствие ключа даёт `dynamic: null`.
   */
  marketDynamic: Record<string, WireMarketDynamic>;
  /**
   * Окно объёма по id рынка. Три состояния, и мир обязан выражать каждое:
   * ключа нет — поля нет в ответе (шлюз старее 0.33.0); `null` — отправлено
   * пустым; объект — измерено.
   */
  marketVolume24h: Record<string, WireVolumeWindow | null>;
  openOrders: GatewayOrder[];
  conditionalOrders: GatewayOrder[];
  trades: TradeRow[];
  /** Ордера в терминальных статусах — вкладка Order History. */
  orderHistory: GatewayOrder[];
  /** Закрытые эпизоды; `available: false` = индексатор молчит про счёт. */
  positionHistory: { available: boolean; episodes: WirePositionEpisode[] };
  settlementLedger: WireLedgerRow[];
  /** `GET /accounts/:id/margin` — офчейн-лок питает строку Equity панели. */
  accountMargin: { available: string; locked: string; free: string };
  /** `GET /accounts/:id/portfolio` — кривая, lifetime-сводка, депозиты/выводы. */
  portfolio: WirePortfolio;
  /** Снимок книги для GET /markets/:id/orderbook (WAD-строки). */
  orderbook: {
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
    asOf: number;
  };

  // --- fault injection ---
  faults: {
    /**
     * «Ответ шлюза на маршруте X падает со статусом N» — одно понятие, одна
     * запись: `world.faults.routeStatus.markets = 500`. Проверка живёт в
     * `faulted()` (`mockGateway.ts`), новому маршруту нужен только ключ в
     * `FaultRoute`.
     */
    routeStatus: Partial<Record<FaultRoute, number>>;
    /**
     * Текст отказа для маршрута из `routeStatus` — `error.message` в теле
     * ответа шлюза. Нет — тело называет только код. Нужен, чтобы проверить,
     * как терминал печатает настоящий отказ (TRM-42).
     */
    routeMessage: Partial<Record<FaultRoute, string>>;
    // chain: make modifyCollateral (deposit/withdraw) txs revert on-chain
    collateralReverts?: boolean;
    // wallet: reject the next wallet_switchEthereumChain / every eth_sendTransaction
    switchChainRejects?: boolean;
    walletSendRejects?: boolean;
    // gateway: refuse every POST /relay with this ErrorCode (the relayed path's
    // failure mode — allowlist, deadline, rate limit — where the wallet path
    // had `walletSendRejects`)
    relayRejects?: string;
    // gateway: one-shot 422 INVALID_NONCE on the next POST /orders, naming
    // the expected nonce (drives the SDK's resync-and-retry path)
    submitNonceConflictExpected?: string;
    // wallet: reject the next eth_requestAccounts (user dismisses the connect prompt)
    connectRejects?: boolean;
  };

  // --- recordings (assertable from specs) ---
  submittedOrders: Array<Record<string, unknown>>;
  cancelledOrderIds: string[];
  /** signed amountDelta of the last modifyCollateral (deposit > 0, withdraw < 0) */
  lastCollateralDelta: bigint;
  /** collateralId (synth market id) of the last modifyCollateral — must be the sUSDC id, not 0 (#459) */
  lastCollateralId: bigint;
  sentTxs: RecordedTx[];
  /** Batches the app handed to the relay, newest last — assertable from specs. */
  relayedBatches: Array<{
    user: string;
    calls: Array<{ to: string; value: string; data: string }>;
    /** Present only on the first relay, while the EOA carries no delegate yet. */
    authorization?: unknown;
  }>;
  relayJobs: Record<string, RelayJob>;
  authNonceRequests: number;
  authVerifyRequests: Array<{ message: string; signature: string }>;
  /** Count of `/auth/verify` calls rejected by `faults.routeStatus.authVerify`. */
  authVerifyRejections: number;
  registeredAccountIds: string[];
  /** Signing methods the wallet performed (personal_sign, eth_signTypedData_v4, …). */
  signRequests: string[];
  /** GET /orders/nonce — the seed the gateway hands the client, and a counter. */
  orderNonce: bigint;
  orderNonceRequests: number;

  // --- SSE frames to emit on the next /sse connection ---
  sseFrames: string[];
  /** channels query-param of every SSE connection the app opened. */
  sseConnections: string[][];

  // --- receipts the mock chain returns for sent txs ---
  receipts: Record<string, ReceiptLog[]>;

  /** Named response barriers an interceptor awaits before replying (loading-state tests). */
  holds: Record<string, Hold>;

  // --- internal ---
  txCounter: number;
  accountCounter: bigint;
  blockNumber: bigint;
}

export interface ReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

interface Hold {
  promise: Promise<void>;
  release: () => void;
}

function defaultCandles(price: bigint): MockWorld["candles"] {
  // Ряд кончается текущим часом, а не датой из прошлого: последний бар должен
  // быть формирующимся, иначе живой цене некуда домешиваться и чарт выглядит
  // застывшим — тем же, чем он был бы на сломанном потоке.
  const base = Math.floor(Date.now() / 1000 / 3600) * 3600 - 24 * 3600; // fixed; LWC only needs ascending unique seconds
  const p = price.toString();
  return Array.from({ length: 30 }, (_, i) => ({
    timestamp: base + i * 60,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: WAD.toString(),
    tradeCount: 1,
    lastTradePrice: p,
  }));
}

/**
 * Двадцать пять часовых баров ровно на +1 % от края до края.
 *
 * @remarks Ровно столько, сколько просит `useDailyChange`, и ровно тот
 * процент, который спека может утверждать текстом: плоский ряд доказал бы
 * только то, что ноль рисуется.
 */
export function defaultOracleCandles(price: bigint): MockWorld["candles"] {
  // Ряд кончается текущим часом, а не датой из прошлого: последний бар должен
  // быть формирующимся, иначе живой цене некуда домешиваться и чарт выглядит
  // застывшим — тем же, чем он был бы на сломанном потоке.
  const base = Math.floor(Date.now() / 1000 / 3600) * 3600 - 24 * 3600;
  const from = (price * 100n) / 101n;
  return Array.from({ length: 25 }, (_, i) => {
    const close = from + ((price - from) * BigInt(i)) / 24n;
    const c = close.toString();
    return {
      timestamp: base + i * 3600,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: WAD.toString(),
      tradeCount: 1,
      lastTradePrice: c,
    };
  });
}

/** Сколько уровней на сторону отдаёт мок: хватает и на 10+10, и на 20 в одну сторону. */
const BOOK_LEVELS = 20;

/**
 * Книга вокруг цены, шаг $10.
 *
 * @remarks Шаг выбран не произвольно: при цене мира $70 000 первый шаг из
 * `bookTickOptions` равен 10, и книга с шагом $1 схлопнулась бы в одну строку
 * на сторону — сетка была бы пустой, а спека проверяла бы группировку вместо
 * книги. Уровни ложатся на границы группы один в один: бид 69 990 округляется
 * вниз в 69 990, аск 70 010 вверх в 70 010.
 */
function defaultBook(price: bigint): MockWorld["orderbook"] {
  const step = 10n * WAD;
  const level = (p: bigint, i: number) => ({
    price: p.toString(),
    size: (BigInt(i + 1) * WAD).toString(),
  });
  return {
    bids: Array.from({ length: BOOK_LEVELS }, (_, i) =>
      level(price - BigInt(i + 1) * step, i),
    ),
    asks: Array.from({ length: BOOK_LEVELS }, (_, i) =>
      level(price + BigInt(i + 1) * step, i),
    ),
    asOf: Date.now(),
  };
}

/** Две точки (+$120 заработано) и один депозит — минимум, на котором видны все плитки. */
export function defaultPortfolio(): WirePortfolio {
  return {
    available: true,
    points: [
      // netDepositsUsd ≠ equityUsd намеренно: иначе pct = pnl/equity и pnl/netDeposits
      // неразличимы (DP-012); Δ(equity − netDeposits) = 120, pct = 120/5000 = 2.40%.
      { timestamp: 1_717_113_600, equityUsd: 5_000, realizedPnlUsd: 0, unrealizedPnlUsd: 0, netDepositsUsd: 4_900 },
      { timestamp: 1_717_200_000, equityUsd: 5_120, realizedPnlUsd: 120, unrealizedPnlUsd: 0, netDepositsUsd: 4_900 },
    ],
    summary: {
      realizedPnlUsd: 120,
      fundingUsd: -2,
      feesUsd: 1,
      volumeUsd: 1_280_000,
      netDepositsUsd: 5_000,
      maxDrawdownPct: null,
      estimated: false,
    },
    collateralEvents: [
      { timestamp: 1_717_113_600, amountUsd: 2_500, type: "deposit", collateralId: "2" },
    ],
  };
}

interface ScenarioOptions {
  accounts?: AccountFixture[];
  price?: bigint;
  markets?: Market[];
  oracleCandles?: Record<string, MockWorld["candles"]>;
  marketDynamic?: Record<string, WireMarketDynamic>;
  marketVolume24h?: Record<string, WireVolumeWindow | null>;
  openOrders?: GatewayOrder[];
  conditionalOrders?: GatewayOrder[];
  trades?: TradeRow[];
  orderHistory?: GatewayOrder[];
  positionHistory?: MockWorld["positionHistory"];
  settlementLedger?: WireLedgerRow[];
  accountMargin?: MockWorld["accountMargin"];
  portfolio?: WirePortfolio;
  orderbook?: MockWorld["orderbook"];
  /**
   * Fault overrides active from the world's construction, not just after
   * `enterTerminal` returns. Needed for faults that must be live for the
   * very first REST call a mounting terminal fires (e.g. the orderbook
   * seed query, which — unlike most gateway queries — never refetches:
   * `useOrderbook`'s seed has `retry: false, staleTime: Infinity`, so a
   * fault set on `world.faults` after boot would never be observed).
   */
  faults?: Partial<MockWorld["faults"]>;
}

/** A connected wallet that owns NO perps account yet. */
export function freshWorld(opts: ScenarioOptions = {}): MockWorld {
  const price = opts.price ?? 70_000n * WAD;
  return {
    wallet: TEST_ADDRESS,
    chainId: CHAIN_ID,
    accounts: opts.accounts ?? [],
    indexPrice: price,
    price,
    orderFees: { maker: 2n * 10n ** 14n, taker: 6n * 10n ** 14n },
    skew: WAD,
    markets: opts.markets ?? [MARKET],
    funding: {
      available: true,
      rate: "1000000000000000", // 0.001 -> "0.1000%"
      velocity: "0",
      index: "0",
      predicted1h: "1000000000000000",
      predicted8h: "1000000000000000",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    candles: defaultCandles(price),
    oracleCandles: opts.oracleCandles ?? {},
    marketDynamic: opts.marketDynamic ?? {
      [MARKET.id]: {
        openInterest: (211_980n * WAD).toString(),
        // −0,0009 %/сут, как в макете.
        currentFundingRate: (-9n * WAD) / 1_000_000n + "",
        indexPrice: price.toString(),
      },
    },
    marketVolume24h: opts.marketVolume24h ?? {
      [MARKET.id]: {
        volumeUsd: (3_350_000n * WAD).toString(),
        volumeBase: (48n * WAD).toString(),
        trades: 120,
        windowStart: 1_717_113_600,
        windowEnd: 1_717_200_000,
      },
    },
    openOrders: opts.openOrders ?? [],
    conditionalOrders: opts.conditionalOrders ?? [],
    trades: opts.trades ?? [],
    orderHistory: opts.orderHistory ?? [],
    positionHistory: opts.positionHistory ?? { available: true, episodes: [] },
    settlementLedger: opts.settlementLedger ?? [],
    accountMargin: opts.accountMargin ?? {
      available: (5_000n * WAD).toString(),
      locked: "0",
      free: (5_000n * WAD).toString(),
    },
    portfolio: opts.portfolio ?? defaultPortfolio(),
    orderbook: opts.orderbook ?? defaultBook(price),
    // `routeStatus` всегда есть: спека дописывает отказ после старта мира
    // (`world.faults.routeStatus.price = 500`), и опциональная запись потребовала
    // бы `?.` в каждой такой строке.
    faults: {
      ...opts.faults,
      routeStatus: { ...opts.faults?.routeStatus },
      routeMessage: { ...opts.faults?.routeMessage },
    },
    submittedOrders: [],
    cancelledOrderIds: [],
    lastCollateralDelta: 0n,
    lastCollateralId: 0n,
    sentTxs: [],
    relayedBatches: [],
    relayJobs: {},
    authNonceRequests: 0,
    authVerifyRequests: [],
    authVerifyRejections: 0,
    registeredAccountIds: [],
    signRequests: [],
    // Must exceed the SDK's timestamp-derived initial nonce (BigInt(Date.now())
    // * 1000n ≈ 1.8e15): syncNonce is monotonic-MAX, so a lower seed would be
    // invisible. 8.8e18 stays above it for centuries.
    orderNonce: 8_888_888_888_888_888_888n,
    orderNonceRequests: 0,
    sseFrames: [],
    sseConnections: [],
    receipts: {},
    holds: {},
    txCounter: 0,
    accountCounter: 1n,
    blockNumber: 1_000_000n,
  };
}

/** Account #1 in ONCHAIN mode, no margin — connected, needs sign-in + deposit. */
export function accountOnchainWorld(opts: ScenarioOptions = {}): MockWorld {
  return freshWorld({
    accounts: [
      {
        id: 1n,
        orderMode: "ONCHAIN",
        available: 0n,
        withdrawable: 0n,
        positions: [],
      },
    ],
    ...opts,
  });
}

/** Account #1 in BOOK mode, funded — connect then sign-in lands straight in the terminal. */
export function readyWorld(opts: ScenarioOptions = {}): MockWorld {
  return freshWorld({
    accounts: [
      {
        id: 1n,
        orderMode: "BOOK",
        available: 5_000n * WAD,
        withdrawable: 5_000n * WAD,
        positions: [],
      },
    ],
    ...opts,
  });
}

export function findAccount(
  world: MockWorld,
  id: bigint,
): AccountFixture | undefined {
  return world.accounts.find((a) => a.id === id);
}

export function nextTxHash(world: MockWorld): string {
  world.txCounter += 1;
  return ("0x" + world.txCounter.toString(16).padStart(64, "0")) as string;
}

/**
 * Install an unresolved barrier under `name`. An interceptor awaits it before
 * replying, so a test can assert the in-flight UI, then release it to settle.
 * Deterministic — no fixed delay, so no timing race.
 */
export function armHold(world: MockWorld, name: string): void {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  world.holds[name] = { promise, release };
}

/** Release + remove a previously armed hold so the held response proceeds. */
export function releaseHold(world: MockWorld, name: string): void {
  world.holds[name]?.release();
  delete world.holds[name];
}

/** A 1.0-BTC long limit order resting at $60k. */
export function limitOrderFixture(
  overrides: Partial<GatewayOrder> = {},
): GatewayOrder {
  return {
    id: "ord-limit-1",
    accountId: "1",
    marketId: MARKET.id,
    sizeDelta: WAD.toString(),
    side: "BUY",
    orderType: "LIMIT",
    status: "PENDING",
    limitPrice: (60_000n * WAD).toString(),
    triggerPrice: null,
    reduceOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    ...overrides,
  };
}

/**
 * A stop-market trigger order.
 *
 * @remarks `reduceOnly: true`, как у ноги скобки: SDK 0.65.0 считает скобкой
 * только reduce-only ногу, закрывающую позицию, — SELL у длинной.
 */
export function conditionalOrderFixture(
  overrides: Partial<GatewayOrder> = {},
): GatewayOrder {
  return {
    id: "ord-cond-1",
    accountId: "1",
    marketId: MARKET.id,
    sizeDelta: (-WAD).toString(),
    side: "SELL",
    orderType: "STOP_MARKET",
    status: "TRIGGER_PENDING",
    limitPrice: null,
    triggerPrice: (80_000n * WAD).toString(),
    reduceOnly: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    ...overrides,
  };
}

export function tradeFixture(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "fill-1",
    timestamp: 1_717_200_000_000,
    marketId: MARKET.id,
    side: "BUY",
    price: (70_000n * WAD).toString(),
    size: WAD.toString(),
    takerAccountId: "1",
    makerAccountId: "2",
    takerOrderId: "ord-a",
    makerOrderId: "ord-b",
    txHash: "0x" + "ab".repeat(32),
    ...overrides,
  };
}

/** Исполненный ордер — строка вкладки Order History. */
export function settledOrderFixture(
  overrides: Partial<GatewayOrder> = {},
): GatewayOrder {
  return {
    ...limitOrderFixture(),
    id: "ord-filled-1",
    status: "SETTLED",
    ...overrides,
  };
}

/** Закрытый лонг на 1 BTC с прибылью $100. */
export function positionEpisodeFixture(
  overrides: Partial<WirePositionEpisode> = {},
): WirePositionEpisode {
  return {
    marketId: MARKET.id,
    symbol: MARKET.symbol,
    direction: "long",
    openedAt: 1_717_200_000,
    closedAt: 1_717_203_600,
    avgEntryPrice: (69_900n * WAD).toString(),
    avgClosePrice: (70_000n * WAD).toString(),
    maxSize: WAD.toString(),
    realizedPnl: (100n * WAD).toString(),
    feesUsd: WAD.toString(),
    closedBy: "trade",
    liquidationPrice: null,
    openInferred: false,
    liquidationTouched: false,
    sizeDiverged: false,
    ...overrides,
  };
}

/** Строка леджера с ненулевым фандингом — она же строка Funding History. */
export function ledgerRowFixture(
  overrides: Partial<WireLedgerRow> = {},
): WireLedgerRow {
  return {
    timestampMs: 1_717_203_600_000,
    txHash: "0x" + "cd".repeat(32),
    logIndex: 3,
    marketId: MARKET.id,
    kind: "settlement",
    sizeDelta: (-WAD).toString(),
    newSize: "0",
    fillPrice: (70_000n * WAD).toString(),
    pricePnl: (100n * WAD).toString(),
    accruedFunding: (-2n * WAD).toString(),
    interest: "0",
    totalFees: WAD.toString(),
    netBalanceDelta: (99n * WAD).toString(),
    liquidationTouched: false,
    ...overrides,
  };
}

/**
 * Кадр SSE `order_update`. По умолчанию — канал ордера `order:{id}`; поток
 * счёта — `channel: "orders:1"` (его слушают тосты исходов). `reason` и
 * `origin` — как на проводе (`OrderUpdateData` из @liq/core).
 */
export function sseOrderUpdateFrame(
  orderId: string,
  status: string,
  opts: { reason?: string; origin?: "pool_execution"; channel?: string } = {},
): string {
  const event = {
    type: "order_update",
    channel: opts.channel ?? `order:${orderId}`,
    data: {
      orderId,
      status,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    },
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Кадр SSE с тиком оракульной цены — `PriceUpdateEvent` из @liq/core,
 * канал `` `price:${marketId}` ``.
 *
 * @remarks `price` — WAD-строка, как на проводе; `timestamp` в СЕКУНДАХ:
 * шлюз намеренно не шлёт по этому каналу миллисекунды, и `useCandles`
 * складывает бар именно по секундной метке. Умолчание — «сейчас», чтобы тик
 * попадал в формирующийся бар, а не в закрытый.
 */
export function ssePriceFrame(
  marketId: string,
  price: bigint,
  timestampSec: number = Math.floor(Date.now() / 1000),
): string {
  return `data: ${JSON.stringify({
    type: "price_update",
    channel: `price:${marketId}`,
    data: { marketId, price: price.toString(), timestamp: timestampSec },
  })}\n\n`;
}

/** Кадр SSE со снимком книги. Форма — `OrderbookSnapshotEvent` из @liq/core. */
export function sseOrderbookFrame(
  marketId: string,
  book: MockWorld["orderbook"],
): string {
  return `data: ${JSON.stringify({
    type: "orderbook_snapshot",
    channel: `orderbook:${marketId}`,
    data: { marketId, bids: book.bids, asks: book.asks, timestamp: book.asOf },
  })}\n\n`;
}

/**
 * Кадр SSE с одной сделкой. Форма — `TradeEvent` из @liq/core: `type: "trade"`,
 * канал `` `trades:${marketId}` ``.
 *
 * @remarks `price`/`size` — человеческие десятичные строки ("70500", "1.5"),
 * как в вызовах этого хелпера, а не WAD-строки: на проводе (`FillBroadcastEventSchema`,
 * тот же контракт, что у `OrderbookBroadcastEventSchema`/`PriceBroadcastEventSchema`)
 * поле — WAD-масштабированное, как и везде в этом файле (`tradeFixture`,
 * `defaultBook`), только там это делает вызывающий код через `n * WAD`; здесь —
 * `parseUnits`, чтобы вызов оставался коротким числом, которое видно глазами
 * в тексте теста. `timestamp` по умолчанию — «сейчас», заведомо новее любой
 * REST-строки фикстуры (та печатается фиксированным прошлым временем из
 * `tradeFixture`), так что сценарий «живое событие встаёт наверх ленты» не
 * обязан явно называть момент.
 */
export function sseTradeFrame(
  marketId: string,
  trade: {
    price: string;
    size: string;
    /**
     * Сторона как на проводе — голая строка, а не пара литералов.
     *
     * @remarks `TradeEventData.side` в SDK типизирован `string`
     * (`FillBroadcastEventSchema` разбирает его как `z.string()`), поэтому
     * значение вне пары — форма, которую провод действительно способен
     * прислать. Сузив тип здесь, мок запретил бы сценарий, который у
     * гейтвея возможен.
     *
     * `(string & {})` вместо голого `string`: два литерала остаются в
     * подсказках редактора, поэтому опечатка `"Buy"` видна как опечатка, а не
     * молча означает «нераспознанная сторона».
     */
    side: "BUY" | "SELL" | (string & {});
    timestamp?: number;
  },
): string {
  const { price, size, side, timestamp = Date.now() } = trade;
  return `data: ${JSON.stringify({
    type: "trade",
    channel: `trades:${marketId}`,
    data: {
      marketId,
      price: parseUnits(price, 18).toString(),
      size: parseUnits(size, 18).toString(),
      side,
      timestamp,
    },
  })}\n\n`;
}

export function longPositionFixture(
  overrides: Partial<PositionFixture> = {},
): PositionFixture {
  return {
    marketId: MARKET.id,
    totalPnl: 100n * WAD,
    accruedFunding: 0n,
    positionSize: WAD, // +1.0 BTC long
    ...overrides,
  };
}
