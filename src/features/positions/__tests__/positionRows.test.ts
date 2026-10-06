import { type GatewayOrder, Qty, Side } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { buildPositionRows } from "../usePositionRows";

const MARKETS = [
  { id: 200n, symbol: "BTC" },
  { id: 100n, symbol: "ETH" },
];

/** Знаковый размер позиции фикстуры: плюс — длинная, минус — короткая. */
const LONG = Qty(10n ** 18n);

function trigger(over: Partial<GatewayOrder>): GatewayOrder {
  return {
    id: "cond-1",
    accountId: "7",
    marketId: "200",
    sizeDelta: "-1000000000000000000",
    side: "SELL",
    orderType: "TAKE_PROFIT_MARKET",
    status: "TRIGGER_PENDING",
    limitPrice: null,
    triggerPrice: "75000000000000000000000",
    reduceOnly: true,
    createdAt: "2026-09-02T00:00:00.000Z",
    ...over,
  } as GatewayOrder;
}

describe("buildPositionRows", () => {
  it("несёт идентификатор заявки, а не только цену скобки", () => {
    // Идентификатор — единственное, чем правка скобки знает, что отменять;
    // прежняя ручная сборка в таблице его теряла.
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: { "200": { price: 70_000n * 10n ** 18n } },
      conditional: [trigger({ id: "tp-9" })],
    });

    expect(row.brackets.takeProfit?.orderId).toBe("tp-9");
    expect(row.brackets.takeProfit?.triggerPrice).toBe(
      75_000n * 10n ** 18n,
    );
    expect(row.brackets.stopLoss).toBeNull();
  });

  it("условный ордер чужого рынка в скобки не попадает", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 100n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      conditional: [trigger({ marketId: "200" })],
    });

    expect(row.symbol).toBe("ETH");
    expect(row.brackets.takeProfit).toBeNull();
    expect(row.brackets.stopLoss).toBeNull();
  });

  it("рынок без цены оракула даёт undefined, а не ноль", () => {
    // Ноль читался бы как цена ноль: по нему посчитались бы и граница
    // проскальзывания, и решение закрывать.
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: {},
      conditional: [],
    });

    expect(row.markPrice).toBeUndefined();
  });

  it("рынок вне списка называется собственным идентификатором", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 999n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      conditional: [],
    });

    expect(row.symbol).toBe("999");
  });

  it("нога другой стороны — не скобка: сирота закрытой короткой у новой длинной (TRM-9)", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      conditional: [trigger({ side: Side.BUY, sizeDelta: "1000000000000000000" })],
    });

    expect(row.brackets.takeProfit).toBeNull();
  });

  it("действующий размер скобки — не больше позиции", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: Qty(10n ** 18n / 2n) }],
      markets: MARKETS,
      prices: undefined,
      conditional: [trigger({ id: "tp-9" })],
    });

    expect(row.brackets.takeProfit?.size).toBe(10n ** 18n);
    expect(row.brackets.takeProfit?.effectiveSize).toBe(10n ** 18n / 2n);
  });
});
