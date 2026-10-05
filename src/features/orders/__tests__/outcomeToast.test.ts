import type { GatewayOrder, OrderUpdateData } from "@liq/core";
import { describe, expect, it } from "vitest";

import { outcomeToast } from "../outcomeToast";

const MARKETS = [{ id: 200n, symbol: "BTC-PERP" }];
const order = {
  id: "ord-1",
  marketId: "200",
  side: "SELL",
  orderType: "STOP_MARKET",
} as GatewayOrder;
const update = (
  status: string,
  extra: Partial<OrderUpdateData> = {},
): OrderUpdateData =>
  ({ orderId: "ord-1", status, ...extra }) as OrderUpdateData;
const known = new Map([["ord-1", order]]);

describe("outcomeToast", () => {
  it("повтор исхода после закрытия тоста молчит", () => {
    const shown = new Set<string>();
    const first = outcomeToast(update("FAILED"), known, shown, MARKETS);
    expect(first?.id).toBe("ord-1:FAILED");
    expect(outcomeToast(update("FAILED"), known, shown, MARKETS)).toBeNull();
  });

  it("голый CANCELLED не глушит следующий CANCELLED с причиной", () => {
    const shown = new Set<string>();
    expect(outcomeToast(update("CANCELLED"), known, shown, MARKETS)).toBeNull();
    const second = outcomeToast(
      update("CANCELLED", { reason: "sibling_triggered" }),
      known,
      shown,
      MARKETS,
    );
    expect(second?.title).toBe("Stop loss cancelled");
  });

  it("подпись — сторона и рынок; ордера нет в кешах — без подписи", () => {
    const shown = new Set<string>();
    expect(outcomeToast(update("FAILED"), known, shown, MARKETS)?.meta).toBe(
      "SELL · BTC-PERP",
    );
    const unknown = outcomeToast(
      { ...update("FAILED"), orderId: "ord-9" },
      known,
      shown,
      MARKETS,
    );
    expect(unknown).toMatchObject({ id: "ord-9:FAILED", meta: undefined });
  });
});
