import { formatUsd } from "@liq/core";
import type { Margin, Price } from "@liq/sdk";

import { DASH, fmtPrice } from "../../lib/format";

/**
 * Сколько заблокирует шлюз под ордер: `max(0, R1 − R0)`.
 *
 * @remarks `r1` — требование протокола ко всему аккаунту после ордера (превью
 * контракта), `r0` — оно же до ордера (`requiredInitialMargin`). Шлюз
 * допускает ордер, если `free ≥ R1`, и блокирует разницу; у сокращающего
 * ордера R1 может быть не выше R0 — тогда не блокируется ничего, и это `0n`,
 * известное значение. `undefined` — одной из двух величин ещё нет (грузится,
 * упало, аккаунта нет): ноль тут соврал бы «бесплатно».
 */
export function lockAmount(input: {
  r1?: Margin | undefined;
  r0?: Margin | undefined;
}): Margin | undefined {
  const { r1, r0 } = input;
  if (r1 === undefined || r0 === undefined) return undefined;
  return (r1 > r0 ? r1 - r0 : 0n) as Margin;
}

/**
 * Требование для предупреждения тикета: большее из известных R1 двух сторон.
 *
 * @remarks Размер у сторон один, различается позиция после ордера: сторона,
 * которая наращивает экспозицию, имеет большее R1 — именно она и есть «сторона
 * с большим размером после ордера». Предупреждение единое на оба исхода, поэтому
 * судит худший из прочитанных. Ни одной стороны не прочитано — `undefined`
 * (предупреждения нет, а не «ноль хватает»).
 *
 * Известное ограничение: пока вторая сторона грузится, а известная — меньшая,
 * предупреждение может недосказать (но не пересказать): ордер, который отказал
 * бы по большей стороне, ещё не помечен. Близнец в liqu-web в этом случае
 * возвращает `undefined`; здесь известная сторона судит сразу.
 */
export function warnRequirement(
  long: Margin | undefined,
  short: Margin | undefined,
): Margin | undefined {
  if (long === undefined) return short;
  if (short === undefined) return long;
  return (long > short ? long : short) as Margin;
}

/** Что известно об одной стороне ордера для печати. */
export interface SideRow {
  /** Блокировка шлюза ({@link lockAmount}); `undefined` — неизвестна. */
  lock: Margin | undefined;
  /** Оценка ликвидации превью; `null` — уровня нет, `undefined` — не прочитана. */
  liq: Price | null | undefined;
}

/** Две строки сводки, по строке на сторону. */
export interface RowsView {
  margin: { long: string; short: string };
  liqPrice: { long: string; short: string };
}

/** Строки «Margin» и «Liq. Price»: неизвестное — прочерк, `0n` — `$0.00`. */
export function rowsView(input: { long: SideRow; short: SideRow }): RowsView {
  const margin = (v: Margin | undefined) =>
    v === undefined ? DASH : formatUsd(v);
  const liq = (v: Price | null | undefined) =>
    v === undefined || v === null ? DASH : fmtPrice(v);
  return {
    margin: {
      long: margin(input.long.lock),
      short: margin(input.short.lock),
    },
    liqPrice: {
      long: liq(input.long.liq),
      short: liq(input.short.liq),
    },
  };
}

/**
 * Задержка цены превью на вкладке Market.
 *
 * @remarks Решение владельца ради паритета с liqu-web. В терминале марк не
 * стримится: он приходит из `usePricesQuery` с `refetchInterval: 5e3`, поэтому
 * задержка не сокращает число мультиколл — она лишь откладывает смену марка в
 * превью максимум на 2 с.
 */
export const MARK_DEBOUNCE_MS = 2000;

/** Марк, привязанный к рынку, на котором он был прочитан. */
export interface MarketMark {
  marketId: bigint;
  mark: bigint;
}

/**
 * Марк для превью из пары, сглаженной задержкой.
 *
 * @remarks Сглаженный марк принадлежит рынку, на котором взят: после смены
 * рынка он, ещё не догнав, остался бы маркой старого рынка и превью нового
 * спрашивалось бы по чужой цене. Поэтому сглаженный марк берётся только если
 * его рынок совпадает с текущим и он положителен; иначе — сырой марк текущего
 * рынка, без ожидания.
 */
export function settledMark(input: {
  current: MarketMark;
  held: MarketMark;
}): bigint {
  const { current, held } = input;
  return held.marketId === current.marketId && held.mark > 0n
    ? held.mark
    : current.mark;
}

/**
 * Цена, по которой спрашивается превью контракта.
 *
 * @remarks Limit — введённая цена как есть, без задержки (`0n` — поля нет,
 * превью выключено). Market — марк, сглаженный `debouncedMark` (его выбирает
 * {@link settledMark}). Ключ запроса несёт цену, так что смена марка — новый
 * запрос, и строки на миг становятся «—»; задержка лишь откладывает эту смену
 * не дольше чем на {@link MARK_DEBOUNCE_MS}. Пока сглаженного марка ещё нет
 * (`0n`, первый кадр), берётся сырой: первое число не ждёт задержки.
 */
export function previewPrice(input: {
  tab: "Market" | "Limit";
  mark: bigint;
  debouncedMark: bigint;
  limit: bigint;
}): bigint {
  if (input.tab === "Limit") return input.limit;
  return input.debouncedMark > 0n ? input.debouncedMark : input.mark;
}
