import { Price, Qty, Usd } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { ticketSummary } from "../ticketSummary";

const MARK = Price.parse("2446.07");
const ONE = Qty.parse("1");

describe("ticketSummary", () => {
  it("количество и объём от стороны не зависят, знаковый размер — зависит", () => {
    const s = ticketSummary({ sizeQty: ONE, markPrice: MARK });
    expect(s.qty).toBe(ONE);
    expect(s.value).toBe(Usd.parse("2446.07"));
    expect(s.long.sizeDelta).toBe(ONE);
    expect(s.short.sizeDelta).toBe(-ONE);
  });

  it("пустой размер не выдумывает чисел", () => {
    const s = ticketSummary({ sizeQty: Qty(0n), markPrice: MARK });
    expect(s.value).toBe(0n);
    expect(s.long.sizeDelta).toBe(0n);
    expect(s.short.sizeDelta).toBe(0n);
  });

  it("без марка объём не считается, размер остаётся", () => {
    const s = ticketSummary({ sizeQty: ONE, markPrice: Price(0n) });
    expect(s.value).toBe(0n);
    expect(s.qty).toBe(ONE);
    expect(s.short.sizeDelta).toBe(-ONE);
  });
});
