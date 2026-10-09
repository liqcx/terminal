import { Margin, Price, Usd } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import {
  lockAmount,
  previewPrice,
  rowsView,
  warnRequirement,
} from "../orderMarginView";

const usd = (s: string) => Margin(Usd.parse(s));

describe("lockAmount", () => {
  it("R1 > R0 — блокируется разница", () => {
    expect(lockAmount({ r1: usd("7000"), r0: usd("3000") })).toBe(usd("4000"));
  });

  it("R1 <= R0 — сокращающий ордер ничего не блокирует: 0n, не отрицательное", () => {
    expect(lockAmount({ r1: usd("1000"), r0: usd("3000") })).toBe(0n);
    expect(lockAmount({ r1: usd("3000"), r0: usd("3000") })).toBe(0n);
  });

  it("нет R1 или нет R0 — неизвестно, а не ноль", () => {
    expect(lockAmount({ r1: undefined, r0: usd("3000") })).toBeUndefined();
    expect(lockAmount({ r1: usd("7000"), r0: undefined })).toBeUndefined();
    expect(lockAmount({})).toBeUndefined();
  });

  it("R0 = 0n — известное значение: блокируется весь R1", () => {
    expect(lockAmount({ r1: usd("7000"), r0: Margin(0n) })).toBe(usd("7000"));
  });
});

describe("warnRequirement", () => {
  it("берёт большее из известных R1 двух сторон", () => {
    expect(warnRequirement(usd("5250"), usd("1750"))).toBe(usd("5250"));
    expect(warnRequirement(usd("1750"), usd("5250"))).toBe(usd("5250"));
  });

  it("одна сторона не прочитана — берёт известную; обе — неизвестно", () => {
    expect(warnRequirement(undefined, usd("1750"))).toBe(usd("1750"));
    expect(warnRequirement(usd("1750"), undefined)).toBe(usd("1750"));
    expect(warnRequirement(undefined, undefined)).toBeUndefined();
  });

  it("нулевое R1 — известное значение, а не отсутствие", () => {
    expect(warnRequirement(Margin(0n), undefined)).toBe(0n);
  });
});

describe("rowsView", () => {
  it("известные значения форматируются; 0n печатается как $0.00", () => {
    const rows = rowsView({
      long: { lock: usd("1750"), liq: Price.parse("66750") },
      short: { lock: Margin(0n), liq: Price.parse("73250") },
    });
    expect(rows.margin).toEqual({ long: "$1,750.00", short: "$0.00" });
    expect(rows.liqPrice).toEqual({ long: "66,750", short: "73,250" });
  });

  it("неизвестное и «уровня нет» — прочерк, а не $0.00", () => {
    const rows = rowsView({
      long: { lock: undefined, liq: undefined },
      short: { lock: undefined, liq: null },
    });
    expect(rows.margin).toEqual({ long: "—", short: "—" });
    expect(rows.liqPrice).toEqual({ long: "—", short: "—" });
  });

  it("стороны независимы: у одной данные есть, у другой нет", () => {
    const rows = rowsView({
      long: { lock: usd("10"), liq: Price.parse("5") },
      short: { lock: undefined, liq: undefined },
    });
    expect(rows.margin).toEqual({ long: "$10.00", short: "—" });
    expect(rows.liqPrice).toEqual({ long: "5", short: "—" });
  });
});

describe("previewPrice", () => {
  const MARK = 70_000n;
  const SLOW = 69_900n;
  const LIMIT = 65_000n;

  it("Market — сглаженный марк, а не сырой", () => {
    expect(
      previewPrice({ tab: "Market", mark: MARK, debouncedMark: SLOW, limit: LIMIT }),
    ).toBe(SLOW);
  });

  it("Market, сглаженного марка ещё нет — сырой, без ожидания", () => {
    expect(
      previewPrice({ tab: "Market", mark: MARK, debouncedMark: 0n, limit: LIMIT }),
    ).toBe(MARK);
  });

  it("Limit — введённая цена, марки не участвуют", () => {
    expect(
      previewPrice({ tab: "Limit", mark: MARK, debouncedMark: SLOW, limit: LIMIT }),
    ).toBe(LIMIT);
  });

  it("Limit без цены — 0n (превью выключено), а не марк", () => {
    expect(
      previewPrice({ tab: "Limit", mark: MARK, debouncedMark: SLOW, limit: 0n }),
    ).toBe(0n);
  });
});
