import { describe, expect, it } from "vitest";

import { exceedsBuyingPower } from "../sizingRules";

const WAD = 10n ** 18n;

describe("exceedsBuyingPower", () => {
  it("размер в пределах потолка — не превышает", () => {
    expect(exceedsBuyingPower(WAD, 2n * WAD)).toBe(false);
    expect(exceedsBuyingPower(2n * WAD, 2n * WAD)).toBe(false);
  });

  it("размер выше потолка — превышает", () => {
    expect(exceedsBuyingPower(3n * WAD, 2n * WAD)).toBe(true);
  });

  it("потолок неизвестен (0n: нет марка или маржи) — не судит", () => {
    // Нулевой потолок — «посчитать нечем», а не «можно ноль»: отсутствие
    // маржи тикет показывает своей строкой, подсветка поля его не дублирует.
    expect(exceedsBuyingPower(WAD, 0n)).toBe(false);
  });

  it("пустой размер — не превышает", () => {
    expect(exceedsBuyingPower(0n, 2n * WAD)).toBe(false);
  });
});
