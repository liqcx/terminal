import { type GatewayOrder, Qty } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { cappedSizes } from "../cappedSizes";

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
    orderType: "TAKE_PROFIT_MARKET",
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

  it("позиция короткая: нога той же стороны, что позиция, — не скобка", () => {
    const m = cappedSizes(
      [{ marketId: 200n, size: Qty(-WAD / 2n) }],
      [sl({ side: "BUY", sizeDelta: WAD.toString() })],
    );
    expect(m.get("sl-1")).toBe(WAD / 2n);
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
});
