import type {
  PortfolioCollateralEvent,
  PortfolioPeriod,
  PortfolioPoint,
  SettlementLedgerRow,
} from "@liq/api-client";
import { wadToNumber } from "@liq/core";
import type { UTCTimestamp } from "lightweight-charts";

import { DASH, fmtPctNum } from "../../lib/format";

/**
 * Чистые вычисления страницы Account. Здесь — и только здесь — встречаются две
 * системы единиц: портфель шлюза (decimal `number`, unix-секунды) и
 * леджер/маржа (WAD `bigint`, миллисекунды).
 */

/**
 * Первая страница леджера — потолок шлюза (`limit ≤ 200`).
 * ponytail: первые 200 расчётов за период; пагинация по `nextCursor` — когда у счёта их станет больше.
 */
export const LEDGER_PAGE = 200;

/** Периоды селектора в порядке макета; `1d` живёт только у Today's PnL. */
export const PERIODS: readonly PortfolioPeriod[] = [
  "7d",
  "30d",
  "180d",
  "365d",
  "all",
];

export const PERIOD_LABEL: Record<PortfolioPeriod, string> = {
  "1d": "1D",
  "7d": "7D",
  "30d": "30D",
  "180d": "180D",
  "365d": "1Y",
  all: "All time",
};

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<Exclude<PortfolioPeriod, "all">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "180d": 180,
  "365d": 365,
};

export interface TimeWindow {
  from?: Date;
  to?: Date;
}

/** Окно периода назад от `nowMs`; `all` — без границ (леджер отдаст всё). */
export function periodWindow(period: PortfolioPeriod, nowMs: number): TimeWindow {
  if (period === "all") return {};
  return {
    from: new Date(nowMs - PERIOD_DAYS[period] * DAY_MS),
    to: new Date(nowMs),
  };
}

/** Заработанное счётом: equity без депозитов и выводов (формула реконструкции шлюза). */
function pnlOf(p: PortfolioPoint): number {
  return p.equityUsd - p.netDepositsUsd;
}

/**
 * PnL за окно кривой: разность заработанного между первой и последней точкой.
 * Меньше двух точек — неизвестно (`undefined`), а не `$0.00`: пустой день и
 * день без данных — разные вещи. Процент — от стартового equity; пустой старт
 * — `null`.
 */
export function windowPnl(
  points: readonly PortfolioPoint[],
): { pnlUsd: number; pct: number | null } | undefined {
  if (points.length < 2) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  const pnlUsd = pnlOf(last) - pnlOf(first);
  return {
    pnlUsd,
    pct: first.equityUsd > 0 ? pnlUsd / first.equityUsd : null,
  };
}

export interface PnlPoint {
  time: UTCTimestamp;
  value: number;
}

/**
 * Кривая накопленного PnL для lightweight-charts: по возрастанию времени и без
 * повторов (библиотека требует строго возрастающий ряд; при дубле берётся
 * последняя точка).
 */
export function pnlSeries(points: readonly PortfolioPoint[]): PnlPoint[] {
  const byTime = new Map<number, number>();
  for (const p of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
    byTime.set(p.timestamp, pnlOf(p));
  }
  return [...byTime].map(([time, value]) => ({
    time: time as UTCTimestamp,
    value,
  }));
}

/**
 * Использование маржи для экрана: WAD-доля SDK (`useMarginUsage().data.usage`)
 * → «28.6%». `undefined` — прочитать нечем или счёт под водой (SDK: требование
 * положительно, `available ≤ 0`) — «—», а не 0 % и не 100 %.
 */
export function fmtUsageWad(usage: bigint | undefined): string {
  return usage === undefined ? DASH : fmtPctNum(wadToNumber(usage));
}

/**
 * Доля нереализованного PnL в стоимости счёта. Без зажима: убыток больше стоимости — настоящий ответ, а не «−100 %».
 * Делить не на что (стоимость неизвестна или неположительна) — `null`.
 */
export function pnlShare(
  pnl: bigint,
  accountValue: bigint | undefined,
): number | null {
  if (accountValue === undefined || accountValue <= 0n) return null;
  return wadToNumber(pnl) / wadToNumber(accountValue);
}

/**
 * Сумма остатков, только когда прочитаны все: пустой список или хоть один
 * непрочитанный элемент — `undefined`, а не частичный итог.
 */
export function sumWhenAllLoaded(
  amounts: (bigint | undefined)[],
): bigint | undefined {
  if (amounts.length === 0 || amounts.some((a) => a === undefined)) {
    return undefined;
  }
  return amounts.reduce<bigint>((sum, a) => sum + a!, 0n);
}

export type ActivityKind = "deposit" | "withdrawal" | "trade" | "liquidation";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  trade: "Trade",
  liquidation: "Liquidation",
};

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  timestampMs: number;
  /** Знаковый USD; `null` — леджер не смог доказать сумму. */
  amountUsd: number | null;
  marketId?: bigint;
  txHash?: string;
}

/**
 * Одна лента из событий депозитов/выводов и строк леджера, новые сверху.
 * Событие: знак — от типа, не от провода. Строка леджера: одна запись на
 * расчёт, сумма — `netBalanceDelta` (фандинг и комиссии уже внутри; отдельная
 * строка фандинга удвоила бы сумму).
 */
export function activityRows(
  events: readonly PortfolioCollateralEvent[],
  ledger: readonly SettlementLedgerRow[],
): ActivityRow[] {
  const fromEvents = events.map<ActivityRow>((e) => ({
    id: `${e.type}-${e.timestamp}-${e.collateralId}-${e.amountUsd}`,
    kind: e.type,
    timestampMs: e.timestamp * 1000,
    amountUsd:
      e.type === "withdrawal" ? -Math.abs(e.amountUsd) : Math.abs(e.amountUsd),
  }));
  const fromLedger = ledger.map<ActivityRow>((r) => ({
    id: `${r.txHash}-${r.logIndex}`,
    kind: r.kind === "liquidation" ? "liquidation" : "trade",
    timestampMs: r.timestampMs,
    amountUsd:
      r.netBalanceDelta === null ? null : wadToNumber(r.netBalanceDelta),
    marketId: r.marketId,
    txHash: r.txHash,
  }));
  return [...fromEvents, ...fromLedger].sort(
    (a, b) => b.timestampMs - a.timestampMs,
  );
}

/** Клиентский фильтр по окну: шлюз не обещает окна для событий депозитов. */
export function withinWindow(
  rows: readonly ActivityRow[],
  range: TimeWindow,
): ActivityRow[] {
  const from = range.from?.getTime() ?? -Infinity;
  const to = range.to?.getTime() ?? Infinity;
  return rows.filter((r) => r.timestampMs >= from && r.timestampMs <= to);
}

export function filterActivity(
  rows: readonly ActivityRow[],
  kind: ActivityKind | "all",
): ActivityRow[] {
  return kind === "all" ? [...rows] : rows.filter((r) => r.kind === kind);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV для кнопки Export: ISO-время, тип, символ рынка, сумма, tx; «нет» — пустая ячейка. */
export function activityCsv(
  rows: readonly ActivityRow[],
  symbolOf: (marketId: bigint) => string,
): string {
  const lines = rows.map((r) =>
    [
      new Date(r.timestampMs).toISOString(),
      ACTIVITY_LABEL[r.kind],
      r.marketId === undefined ? "" : symbolOf(r.marketId),
      r.amountUsd === null ? "" : r.amountUsd.toFixed(2),
      r.txHash ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return ["time,type,market,amount_usd,tx", ...lines].join("\n");
}
