import { Margin, Price, Usd } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import {
  type HeldFigures,
  holdPreviewStep,
  lockAmount,
  previewPrice,
  rowsView,
  settledMark,
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

  // Известное недосказывание (не пересказывание): пока большая сторона
  // грузится, судит известная меньшая — liqu-web в этом случае вернул бы
  // undefined, терминал показывает известное.
  it("известна только меньшая сторона — она и судит (недосказывание, пока вторая грузится)", () => {
    const r1Reducing = usd("1750");
    expect(warnRequirement(r1Reducing, undefined)).toBe(r1Reducing);
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

describe("settledMark", () => {
  const BTC = 200n;
  const ETH = 201n;

  it("тот же рынок — сглаженный марк", () => {
    expect(
      settledMark({
        current: { marketId: BTC, mark: 70_000n },
        held: { marketId: BTC, mark: 69_900n },
      }),
    ).toBe(69_900n);
  });

  it("другой рынок — сырой марк текущего, а не чужой сглаженный", () => {
    expect(
      settledMark({
        current: { marketId: ETH, mark: 2_000n },
        held: { marketId: BTC, mark: 70_000n },
      }),
    ).toBe(2_000n);
  });

  it("сглаженного марка ещё нет (0n) — сырой", () => {
    expect(
      settledMark({
        current: { marketId: BTC, mark: 70_000n },
        held: { marketId: BTC, mark: 0n },
      }),
    ).toBe(70_000n);
  });
});

describe("rowsView stale", () => {
  it("пометка удержания идёт по сторонам и по умолчанию снята", () => {
    const rows = rowsView({
      long: { lock: usd("10"), liq: Price.parse("5"), stale: true },
      short: { lock: usd("10"), liq: Price.parse("5") },
    });
    expect(rows.stale).toEqual({ long: true, short: false });
  });
});

describe("holdPreviewStep", () => {
  const KEY = "1:200:base:1";
  const R1 = usd("3500");
  const LIQ = Price.parse("66750");
  const landed = { r1: R1, liq: LIQ };
  const unread = { r1: undefined, liq: undefined };
  const held: HeldFigures = { key: KEY, r1: R1, liq: LIQ };

  it("прочитано — показывает прочитанное и запоминает его", () => {
    const step = holdPreviewStep(undefined, KEY, landed, false);
    expect(step.shown).toEqual({ r1: R1, liq: LIQ, stale: false });
    expect(step.held).toEqual(held);
  });

  it("прочитано то же самое — удержанное состояние то же по ссылке", () => {
    const step = holdPreviewStep(held, KEY, landed, false);
    expect(step.held).toBe(held);
  });

  it("тот же ключ, чтение в пути (сдвинулась цена) — удерживает цифры, помечая их", () => {
    const step = holdPreviewStep(held, KEY, unread, true);
    expect(step.shown).toEqual({ r1: R1, liq: LIQ, stale: true });
    expect(step.held).toBe(held);
  });

  it("новое чтение по тому же ключу перебивает удержанное", () => {
    const next = { r1: usd("3550"), liq: Price.parse("66800") };
    const step = holdPreviewStep(held, KEY, next, false);
    expect(step.shown).toEqual({ r1: next.r1, liq: next.liq, stale: false });
    expect(step.held).toEqual({ key: KEY, r1: next.r1, liq: next.liq });
  });

  it("сменился размер — прочерк и удержанное сброшено", () => {
    const step = holdPreviewStep(held, "1:200:base:2", unread, true);
    expect(step.shown).toEqual({ r1: undefined, liq: undefined, stale: false });
    expect(step.held).toBeUndefined();
  });

  it("сменился рынок — прочерк и удержанное сброшено", () => {
    const step = holdPreviewStep(held, "1:201:base:1", unread, true);
    expect(step.shown).toEqual({ r1: undefined, liq: undefined, stale: false });
    expect(step.held).toBeUndefined();
  });

  it("сменился аккаунт — прочерк и удержанное сброшено", () => {
    const step = holdPreviewStep(held, "2:200:base:1", unread, true);
    expect(step.shown.r1).toBeUndefined();
    expect(step.held).toBeUndefined();
  });

  it("чтение упало или запрос выключен (не в пути, цифр нет) — прочерк и удержанное сброшено", () => {
    const step = holdPreviewStep(held, KEY, unread, false);
    expect(step.shown).toEqual({ r1: undefined, liq: undefined, stale: false });
    expect(step.held).toBeUndefined();
  });

  it("«уровня ликвидации нет» (null) остаётся null, а не «не прочитано»", () => {
    const withNull = { r1: R1, liq: null };
    const step = holdPreviewStep(undefined, KEY, withNull, false);
    expect(step.shown.liq).toBeNull();
    const heldNull = step.held;
    const held2 = holdPreviewStep(heldNull, KEY, unread, true);
    expect(held2.shown).toEqual({ r1: R1, liq: null, stale: true });
  });
});
