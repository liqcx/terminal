import { describe, expect, it } from "vitest";

import { repayShortfall } from "../repayShortfall";

const WAD = 10n ** 18n;

describe("repayShortfall", () => {
  it("без долга не мешает выводу", () => {
    expect(repayShortfall(0n, 0n)).toBeNull();
    expect(repayShortfall(undefined, 0n)).toBeNull();
  });

  it("пока баланс кошелька не пришёл — не гасит", () => {
    // Молчащий RPC отдаёт нули; ложная блокировка вывода хуже ревёрта,
    // который теперь печатается словами.
    expect(repayShortfall(168n * WAD, undefined)).toBeNull();
  });

  it("кошелька не хватает до долга — отвечает недостачей", () => {
    // TRM-29: долг $168, в кошельке 0 — «Repay & Withdraw» откатывался.
    expect(repayShortfall(168n * WAD, 0n)).toBe(168n * WAD);
    expect(repayShortfall(168n * WAD, 100n * WAD)).toBe(68n * WAD);
  });

  it("ровно на долг или больше — гасить можно", () => {
    expect(repayShortfall(168n * WAD, 168n * WAD)).toBeNull();
    expect(repayShortfall(168n * WAD, 400n * WAD)).toBeNull();
  });
});
