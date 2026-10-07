import { type GatewayOrder, OrderStatus, OrderType, Qty, Side } from "@liq/sdk";
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
      orders: [trigger({ id: "tp-9" })],
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
      orders: [trigger({ marketId: "200" })],
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
      orders: [],
    });

    expect(row.markPrice).toBeUndefined();
  });

  it("рынок вне списка называется собственным идентификатором", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 999n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      orders: [],
    });

    expect(row.symbol).toBe("999");
  });

  it("нога другой стороны — не скобка: сирота закрытой короткой у новой длинной (TRM-9)", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      orders: [trigger({ side: Side.BUY, sizeDelta: "1000000000000000000" })],
    });

    expect(row.brackets.takeProfit).toBeNull();
  });

  it("действующий размер скобки — не больше позиции", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: Qty(10n ** 18n / 2n) }],
      markets: MARKETS,
      prices: undefined,
      orders: [trigger({ id: "tp-9" })],
    });

    expect(row.brackets.takeProfit?.size).toBe(10n ** 18n);
    expect(row.brackets.takeProfit?.effectiveSize).toBe(10n ** 18n / 2n);
  });

  it("ноги — все reduce-only ордера позиции: две TP и reduce-only лимитка (TRM-48, TRM-57)", () => {
    const limit = trigger({
      id: "lim-1",
      orderType: OrderType.LIMIT,
      status: OrderStatus.PENDING,
      triggerPrice: null,
      limitPrice: (95_000n * 10n ** 18n).toString(),
      sizeDelta: (-3n * 10n ** 18n).toString(),
    });
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      orders: [trigger({ id: "tp-1" }), trigger({ id: "tp-2" }), limit],
    });

    expect(row.legs.map((l) => l.orderId)).toEqual(["tp-1", "tp-2", "lim-1"]);
    expect(row.legs[2].size).toBe(3n * 10n ** 18n);
    expect(row.legs[2].effectiveSize).toBe(10n ** 18n);
  });

  it("обычная (не reduce-only) лимитка и ордер чужого рынка в ноги не попадают", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: LONG }],
      markets: MARKETS,
      prices: undefined,
      orders: [
        trigger({
          id: "lim-plain",
          orderType: OrderType.LIMIT,
          status: OrderStatus.PENDING,
          reduceOnly: false,
          triggerPrice: null,
        }),
        trigger({ id: "tp-eth", marketId: "100" }),
      ],
    });

    expect(row.legs).toEqual([]);
  });
});
