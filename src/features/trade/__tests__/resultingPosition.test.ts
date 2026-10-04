import { Qty, Side } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { resultingPosition } from "../resultingPosition";

const WAD = 10n ** 18n;
const MARKET = 200n;

describe("resultingPosition", () => {
  it("без открытой позиции даёт сторону входа", () => {
    expect(resultingPosition(MARKET, undefined, Qty(WAD))).toEqual({
      marketId: MARKET,
      side: Side.BUY,
      size: Qty(WAD),
    });
    expect(resultingPosition(MARKET, undefined, Qty(-WAD))).toEqual({
      marketId: MARKET,
      side: Side.SELL,
      size: Qty(-WAD),
    });
  });

  it("долив складывается с открытой позицией", () => {
    const open = { size: 2n * WAD };
    expect(resultingPosition(MARKET, open, Qty(WAD)).size).toBe(Qty(3n * WAD));
  });

  it("частичное закрытие сохраняет сторону открытой позиции", () => {
    // Лонг 2, продажа 1 — рынок остаётся длинным, и скобки принадлежат лонгу.
    // Сторона кнопки здесь солгала бы: у Sell скобки судились бы как у шорта.
    const open = { size: 2n * WAD };
    expect(resultingPosition(MARKET, open, Qty(-WAD))).toEqual({
      marketId: MARKET,
      side: Side.BUY,
      size: Qty(WAD),
    });
  });

  it("переворот меняет сторону", () => {
    const open = { size: WAD };
    expect(resultingPosition(MARKET, open, Qty(-3n * WAD))).toEqual({
      marketId: MARKET,
      side: Side.SELL,
      size: Qty(-2n * WAD),
    });
  });

  it("полное закрытие даёт нулевой размер", () => {
    // Ног у такой позиции нет; вердикт по ней пуст — это решает SDK.
    const open = { size: WAD };
    expect(resultingPosition(MARKET, open, Qty(-WAD)).size).toBe(Qty(0n));
  });

  it("короткая открытая позиция приходит со знаком и гасится покупкой", () => {
    // С SDK 0.63 размер позиции знаковый у всех источников (deep-07): шорт 1 —
    // это size = -1, а не модуль с SELL. Покупка 1 его закрывает.
    const open = { size: -WAD };
    expect(resultingPosition(MARKET, open, Qty(WAD)).size).toBe(Qty(0n));
  });
});
