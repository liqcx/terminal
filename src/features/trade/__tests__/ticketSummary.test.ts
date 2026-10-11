import { Price, Qty, Usd } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { ticketPrice, ticketSummary } from "../ticketSummary";

const MARK = Price.parse("2446.07");
const ONE = Qty.parse("1");

describe("ticketSummary", () => {
  it("количество и объём от стороны не зависят, знаковый размер — зависит", () => {
    const s = ticketSummary({ sizeQty: ONE, price: MARK });
    expect(s.qty).toBe(ONE);
    expect(s.value).toBe(Usd.parse("2446.07"));
    expect(s.long.sizeDelta).toBe(ONE);
    expect(s.short.sizeDelta).toBe(-ONE);
  });

  it("пустой размер не выдумывает чисел", () => {
    const s = ticketSummary({ sizeQty: Qty(0n), price: MARK });
    expect(s.value).toBe(0n);
    expect(s.long.sizeDelta).toBe(0n);
    expect(s.short.sizeDelta).toBe(0n);
  });

  it("без цены объём не считается, размер остаётся", () => {
    const s = ticketSummary({ sizeQty: ONE, price: Price(0n) });
    expect(s.value).toBe(0n);
    expect(s.qty).toBe(ONE);
    expect(s.short.sizeDelta).toBe(-ONE);
  });
});

describe("ticketPrice", () => {
  const mark = Price.parse("2446.07");
  const limit = Price.parse("2000");

  it("Market — марк, введённая лимитная цена не влияет", () => {
    expect(ticketPrice({ tab: "Market", mark, limit })).toBe(mark);
  });

  it("Limit — введённая цена, не марк (TRM-36)", () => {
    expect(ticketPrice({ tab: "Limit", mark, limit })).toBe(limit);
    expect(
      ticketSummary({ sizeQty: ONE, price: Price(ticketPrice({ tab: "Limit", mark, limit })) }).value,
    ).toBe(Usd.parse("2000"));
  });

  it("Limit без введённой цены — марк, а не ноль", () => {
    expect(ticketPrice({ tab: "Limit", mark, limit: 0n })).toBe(mark);
  });
});
