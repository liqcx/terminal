import type {
  PortfolioCollateralEvent,
  PortfolioPoint,
  SettlementLedgerRow,
} from "@liq/api-client";
import { describe, expect, it } from "vitest";

import {
  activityCsv,
  activityRows,
  filterActivity,
  fmtUsageWad,
  periodWindow,
  pnlSeries,
  pnlShare,
  sumWhenAllLoaded,
  windowPnl,
  withinWindow,
} from "../accountLogic";

const WAD = 10n ** 18n;
const DAY = 86_400_000;

function point(over: Partial<PortfolioPoint>): PortfolioPoint {
  return {
    timestamp: 1_700_000_000,
    equityUsd: 1_000,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    netDepositsUsd: 1_000,
    ...over,
  };
}

function ledger(over: Partial<SettlementLedgerRow>): SettlementLedgerRow {
  return {
    timestampMs: 1_700_000_000_000,
    txHash: "0x" + "ab".repeat(32),
    logIndex: 1,
    marketId: 100n,
    kind: "settlement",
    sizeDelta: -WAD,
    newSize: 0n,
    fillPrice: 70_000n * WAD,
    pricePnl: 100n * WAD,
    accruedFunding: -2n * WAD,
    interest: 0n,
    totalFees: WAD,
    netBalanceDelta: 99n * WAD,
    ...over,
  } as SettlementLedgerRow;
}

const deposit: PortfolioCollateralEvent = {
  timestamp: 1_700_000_100,
  amountUsd: 2_500,
  type: "deposit",
  collateralId: "2",
};

describe("окно периода", () => {
  it("даёт from/to назад от now, all — без границ", () => {
    const now = 1_800_000_000_000;
    expect(periodWindow("7d", now)).toEqual({
      from: new Date(now - 7 * DAY),
      to: new Date(now),
    });
    expect(periodWindow("all", now)).toEqual({});
  });
});

describe("PnL окна", () => {
  it("депозит посреди окна прибылью не считается", () => {
    const pnl = windowPnl([
      // netDepositsUsd ≠ equityUsd у первой точки: pct считается от equity, не от депозитов.
      point({ equityUsd: 1_000, netDepositsUsd: 800 }),
      point({ equityUsd: 2_050, netDepositsUsd: 1_800 }),
    ]);
    expect(pnl).toEqual({ pnlUsd: 50, pct: 0.05 });
  });

  it("меньше двух точек — неизвестно, а не ноль", () => {
    expect(windowPnl([])).toBeUndefined();
    expect(windowPnl([point({})])).toBeUndefined();
  });

  it("пустой стартовый счёт — процент неизвестен", () => {
    const pnl = windowPnl([
      point({ equityUsd: 0, netDepositsUsd: 0 }),
      point({ equityUsd: 10, netDepositsUsd: 0 }),
    ]);
    expect(pnl).toEqual({ pnlUsd: 10, pct: null });
  });

  it("серия — equity минус депозиты, по возрастанию времени, без дублей", () => {
    const s = pnlSeries([
      point({ timestamp: 20, equityUsd: 1_200, netDepositsUsd: 1_000 }),
      point({ timestamp: 10, equityUsd: 1_000, netDepositsUsd: 1_000 }),
      point({ timestamp: 20, equityUsd: 1_300, netDepositsUsd: 1_000 }),
    ]);
    expect(s).toEqual([
      { time: 10, value: 0 },
      { time: 20, value: 300 },
    ]);
  });
});

describe("использование маржи на экране", () => {
  it("WAD-доля SDK → процент с одним знаком", () => {
    expect(fmtUsageWad(286n * 10n ** 15n)).toBe("28.6%");
    expect(fmtUsageWad(0n)).toBe("0.0%");
  });

  it("нет чтения или счёт под водой — «—», не 0 % и не 100 %", () => {
    expect(fmtUsageWad(undefined)).toBe("—");
  });
});

describe("доля нереализованного PnL в стоимости счёта", () => {
  it("отношение к стоимости счёта, без зажима", () => {
    expect(pnlShare(100n * WAD, 1_000n * WAD)).toBe(0.1);
    expect(pnlShare(-50n * WAD, 1_000n * WAD)).toBe(-0.05);
  });

  it("делить не на что — null, а не 0", () => {
    expect(pnlShare(100n * WAD, 0n)).toBeNull();
    expect(pnlShare(100n * WAD, undefined)).toBeNull();
  });
});

describe("сумма остатков коллатералов", () => {
  it("все прочитаны — сумма; хоть один в полёте или список пуст — undefined", () => {
    expect(sumWhenAllLoaded([1n * WAD, 2n * WAD, 3n * WAD])).toBe(6n * WAD);
    expect(sumWhenAllLoaded([1n * WAD, undefined, 3n * WAD])).toBeUndefined();
    expect(sumWhenAllLoaded([])).toBeUndefined();
  });
});

describe("лента активности", () => {
  it("сливает секунды событий с миллисекундами леджера, новые сверху", () => {
    const rows = activityRows(
      [deposit],
      [ledger({ timestampMs: 1_700_000_000_000 })],
    );
    expect(rows.map((r) => r.kind)).toEqual(["deposit", "trade"]);
    expect(rows[0].timestampMs).toBe(1_700_000_100_000);
    expect(rows[0].amountUsd).toBe(2_500);
    expect(rows[1].amountUsd).toBe(99);
    expect(rows[1].marketId).toBe(100n);
  });

  it("вывод — со знаком минус независимо от знака на проводе", () => {
    const [row] = activityRows(
      [{ ...deposit, type: "withdrawal", amountUsd: 500 }],
      [],
    );
    expect(row.kind).toBe("withdrawal");
    expect(row.amountUsd).toBe(-500);
  });

  it("ликвидация — своим типом; недоказуемая сумма — null", () => {
    const [row] = activityRows(
      [],
      [ledger({ kind: "liquidation", netBalanceDelta: null })],
    );
    expect(row.kind).toBe("liquidation");
    expect(row.amountUsd).toBeNull();
  });

  it("фильтр по типу и по окну", () => {
    const rows = activityRows([deposit], [ledger({})]);
    expect(filterActivity(rows, "deposit")).toHaveLength(1);
    expect(filterActivity(rows, "all")).toHaveLength(2);
    expect(
      withinWindow(rows, {
        from: new Date(1_700_000_050_000),
        to: new Date(1_700_000_200_000),
      }),
    ).toHaveLength(1);
    // Границы окна включительны: строка ровно на `from` (расчёт леджера) и
    // строка ровно на `to` (депозит) обе остаются.
    expect(
      withinWindow(rows, {
        from: new Date(1_700_000_000_000),
        to: new Date(1_700_000_100_000),
      }),
    ).toHaveLength(2);
    expect(withinWindow(rows, {})).toHaveLength(2);
  });

  it("CSV: заголовок, ISO-время, символ рынка, пустые ячейки для «нет»", () => {
    const rows = activityRows(
      [deposit],
      [ledger({ netBalanceDelta: null })],
    );
    const csv = activityCsv(rows, () => "BTC,USD");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("time,type,market,amount_usd,tx");
    expect(lines[1]).toBe("2023-11-14T22:15:00.000Z,Deposit,,2500.00,");
    expect(lines[2]).toBe(
      `2023-11-14T22:13:20.000Z,Trade,"BTC,USD",,0x${"ab".repeat(32)}`,
    );
  });
});
