import { Price } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import {
  fmtLeverage,
  fmtPctNum,
  fmtPrice,
  fmtSignedPct,
  fmtSignedPctNum,
  fmtSignedUsd,
  fmtSignedUsdNum,
  fmtUsdNum,
  parseOrZero,
} from "@/lib/format";

const WAD = 10n ** 18n;

describe("обёртки над форматтерами SDK", () => {
  it("fmtPrice: без `$`, без обязательных копеек, с разрядами", () => {
    expect(fmtPrice(69_900n * WAD)).toBe("69,900");
    expect(fmtPrice((12_345n * WAD) / 10n)).toBe("1,234.5");
  });

  it("fmtSignedUsd: плюс дописан, минус от SDK", () => {
    expect(fmtSignedUsd(100n * WAD)).toBe("+$100.00");
    expect(fmtSignedUsd(-1234n * WAD)).toBe("-$1,234.00");
  });

  it("fmtSignedPct: WAD-доля со знаком", () => {
    expect(fmtSignedPct((123n * WAD) / 10_000n)).toBe("+1.23%");
    expect(fmtSignedPct((-5n * WAD) / 100n)).toBe("-5.00%");
  });

  it("fmtLeverage: всегда два знака — как в карточке счёта и позициях", () => {
    expect(fmtLeverage(0n)).toBe("0.00x");
    expect(fmtLeverage(WAD / 2n)).toBe("0.50x");
    expect(fmtLeverage((35n * WAD) / 10n)).toBe("3.50x");
    expect(fmtLeverage(10n * WAD)).toBe("10.00x");
  });

  it("parseOrZero: пусто и мусор — ноль, число — число", () => {
    expect(parseOrZero(Price.parse, "")).toBe(0n);
    expect(parseOrZero(Price.parse, "abc")).toBe(0n);
    expect(parseOrZero(Price.parse, "1.5")).toBe((15n * WAD) / 10n);
  });
});

describe("decimal-числа портфеля шлюза", () => {
  it("fmtUsdNum: валюта с разрядами и двумя знаками", () => {
    expect(fmtUsdNum(1234.5)).toBe("$1,234.50");
    expect(fmtUsdNum(0)).toBe("$0.00");
    expect(fmtUsdNum(-12)).toBe("-$12.00");
  });

  it("fmtSignedUsdNum: плюс дописан, ноль без знака, минус-ноль — ноль", () => {
    expect(fmtSignedUsdNum(1923.4)).toBe("+$1,923.40");
    expect(fmtSignedUsdNum(-500)).toBe("-$500.00");
    expect(fmtSignedUsdNum(0)).toBe("$0.00");
    expect(fmtSignedUsdNum(-0)).toBe("$0.00");
  });

  it("fmtPctNum и fmtSignedPctNum: доля → проценты", () => {
    expect(fmtPctNum(0.286)).toBe("28.6%");
    expect(fmtPctNum(1)).toBe("100.0%");
    expect(fmtSignedPctNum(0.0203)).toBe("+2.03%");
    expect(fmtSignedPctNum(-0.01)).toBe("-1.00%");
  });
});
