import { describe, expect, it } from "vitest";

import { tpslDecimals, tpslPrefill } from "../tpslFields";

const WAD = 10n ** 18n;
const XRP_ENTRY = (15n * WAD) / 10n; // 1.5
const XRP_TRIGGER = (15_015n * WAD) / 10_000n; // 1.5015

describe("tpslDecimals", () => {
  it("без марка берёт цену входа: XRP — четыре знака, а не два", () => {
    expect(tpslDecimals(undefined, XRP_ENTRY)).toBe(4);
  });

  it("марк, когда он есть, главнее цены входа", () => {
    expect(tpslDecimals(2_693n * WAD, XRP_ENTRY)).toBe(2);
  });
});

describe("tpslPrefill", () => {
  it("диалог открыт до загрузки цен: триггер 1.5015 не округляется до 1.5", () => {
    const decimals = tpslDecimals(undefined, XRP_ENTRY);
    expect(tpslPrefill(XRP_TRIGGER, decimals)).toBe("1.5015");
  });

  it("знаков не меньше, чем нужно самому триггеру, даже при двух от марка", () => {
    expect(tpslPrefill(XRP_TRIGGER, 2)).toBe("1.5015");
  });

  it("дорогой рынок печатается как раньше, без лишних нулей", () => {
    expect(tpslPrefill(75_000n * WAD, 2)).toBe("75000");
    expect(tpslPrefill((750_001n * WAD) / 10n, 2)).toBe("75000.1");
  });
});
