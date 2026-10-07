import { type GatewayOrder, OrderStatus, OrderType, Qty, Side } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { cappedSizes } from "../cappedSizes";
import { mergeById } from "../mergeById";

const WAD = 10n ** 18n;

const sl = (over: Partial<GatewayOrder> = {}): GatewayOrder =>
  ({
    id: "sl-1",
    accountId: "1",
    marketId: "200",
    sizeDelta: (-WAD).toString(),
    side: "SELL",
    orderType: "STOP_MARKET",
    status: "TRIGGER_PENDING",
    reduceOnly: true,
    limitPrice: null,
    triggerPrice: (60_000n * WAD).toString(),
    createdAt: "2026-10-06T00:00:00.000Z",
    groupId: null,
    ...over,
  }) as GatewayOrder;

const tp = (over: Partial<GatewayOrder> = {}): GatewayOrder =>
  sl({
    id: "tp-1",
    orderType: OrderType.TAKE_PROFIT_MARKET,
    triggerPrice: (90_000n * WAD).toString(),
    // Подписан на 3 — отличается от размера стопа, чтобы значения не путались.
    sizeDelta: (-3n * WAD).toString(),
    ...over,
  });

describe("cappedSizes", () => {
  it("после частичного закрытия скобка урезана до позиции (TRM-21)", () => {
    const m = cappedSizes([{ marketId: 200n, size: Qty(WAD / 2n) }], [sl()]);
    expect(m.get("sl-1")).toBe(WAD / 2n);
  });

  it("скобка не больше позиции — не урезана, в карте её нет", () => {
    expect(
      cappedSizes([{ marketId: 200n, size: Qty(WAD) }], [sl()]).has("sl-1"),
    ).toBe(false);
  });

  it("скобка ровно в размер позиции — не урезана (граница)", () => {
    expect(
      cappedSizes([{ marketId: 200n, size: Qty(2n * WAD) }], [sl()]).size,
    ).toBe(0);
  });

  it("урезана только та нога, что больше позиции, — вторая в карте не появляется", () => {
    const m = cappedSizes([{ marketId: 200n, size: Qty(2n * WAD) }], [sl(), tp()]);
    expect(m.size).toBe(1);
    expect(m.get("tp-1")).toBe(2n * WAD);
    expect(m.has("sl-1")).toBe(false);
  });

  it("короткая позиция: закрывающая BUY-нога урезается до |размера|", () => {
    const m = cappedSizes(
      [{ marketId: 200n, size: Qty(-WAD / 2n) }],
      [sl({ side: Side.BUY, sizeDelta: WAD.toString() })],
    );
    expect(m.get("sl-1")).toBe(WAD / 2n);
  });

  it("две позиции на разных рынках — урезаны обе, обе записи в карте", () => {
    const m = cappedSizes(
      [
        { marketId: 200n, size: Qty(WAD / 2n) },
        { marketId: 100n, size: Qty(WAD / 4n) },
      ],
      [sl(), sl({ id: "sl-eth", marketId: "100" })],
    );
    expect(m.size).toBe(2);
    expect(m.get("sl-1")).toBe(WAD / 2n);
    expect(m.get("sl-eth")).toBe(WAD / 4n);
  });

  it("нога без своей позиции (сирота) — не скобка, в карте её нет", () => {
    expect(cappedSizes([], [sl()]).size).toBe(0);
    expect(cappedSizes([{ marketId: 200n, size: Qty(-WAD) }], [sl()]).size).toBe(0);
  });

  it("ногу чужого рынка позиция не урезает", () => {
    expect(
      cappedSizes([{ marketId: 100n, size: Qty(WAD / 2n) }], [sl()]).size,
    ).toBe(0);
  });

  it("reduce-only лимитка больше позиции урезана до позиции (TRM-48)", () => {
    const limit = sl({
      id: "l-1",
      orderType: OrderType.LIMIT,
      status: OrderStatus.PENDING,
      triggerPrice: null,
      limitPrice: (95_000n * WAD).toString(),
      sizeDelta: (-3n * WAD).toString(),
    });
    const m = cappedSizes([{ marketId: 200n, size: Qty(WAD) }], [limit]);
    expect(m.get("l-1")).toBe(WAD);
  });

  it("вторая TP-нога тоже урезана, не только первая (TRM-48)", () => {
    const m = cappedSizes([{ marketId: 200n, size: Qty(WAD / 2n) }], [tp(), tp({ id: "tp-2" })]);
    expect(m.get("tp-1")).toBe(WAD / 2n);
    expect(m.get("tp-2")).toBe(WAD / 2n);
  });

  it("частично исполненная лимитка с остатком меньше позиции не урезана, с остатком больше — урезана до позиции", () => {
    // Подписана на 3, исполнено 1, остаток 2.
    const partial = sl({
      id: "l-2",
      orderType: OrderType.LIMIT,
      status: OrderStatus.PARTIALLY_FILLED,
      triggerPrice: null,
      limitPrice: (95_000n * WAD).toString(),
      sizeDelta: (-3n * WAD).toString(),
      remainingSize: (2n * WAD).toString(),
    });
    // Позиция 7 больше остатка: размер уменьшило исполнение, а не позиция.
    expect(
      cappedSizes([{ marketId: 200n, size: Qty(7n * WAD) }], [partial]).has("l-2"),
    ).toBe(false);
    // Позиция 1 меньше остатка: урезала позиция.
    expect(cappedSizes([{ marketId: 200n, size: Qty(WAD) }], [partial]).get("l-2")).toBe(WAD);
  });

  it("remainingSize: null — остаток равен подписанному размеру", () => {
    const fresh = sl({
      id: "l-3",
      orderType: OrderType.LIMIT,
      status: OrderStatus.PENDING,
      triggerPrice: null,
      sizeDelta: (-3n * WAD).toString(),
      remainingSize: null,
    });
    expect(cappedSizes([{ marketId: 200n, size: Qty(WAD) }], [fresh]).get("l-3")).toBe(WAD);
    expect(cappedSizes([{ marketId: 200n, size: Qty(3n * WAD) }], [fresh]).has("l-3")).toBe(
      false,
    );
  });

  it("остаток берётся у первого вхождения id, как и ноги в SDK", () => {
    // Свежая копия: остаток 1; устаревшая: остаток 3. Позиция 7 не урезает ни ту, ни другую,
    // но по устаревшей остатку «1 < 3» ногу сочли бы урезанной.
    const base = {
      id: "l-4",
      orderType: OrderType.LIMIT,
      status: OrderStatus.PARTIALLY_FILLED,
      triggerPrice: null,
      sizeDelta: (-3n * WAD).toString(),
    };
    const fresh = sl({ ...base, remainingSize: WAD.toString() });
    const stale = sl({ ...base, remainingSize: (3n * WAD).toString() });
    expect(
      cappedSizes([{ marketId: 200n, size: Qty(7n * WAD) }], [fresh, stale]).has("l-4"),
    ).toBe(false);
  });

  it("сработавший стоп из открытых побеждает устаревший TRIGGER_PENDING из условных — урезания нет", () => {
    // Позиция 1/2, стоп подписан на 1: в условных он ещё жив и был бы урезан.
    const position = [{ marketId: 200n, size: Qty(WAD / 2n) }];
    const stale = sl();
    const triggered = sl({ status: OrderStatus.TRIGGERED });
    expect(cappedSizes(position, mergeById([triggered], [stale])).size).toBe(0);
    // Контроль: без свежей записи тот же стоп урезан.
    expect(cappedSizes(position, mergeById([], [stale])).get("sl-1")).toBe(WAD / 2n);
  });
});
