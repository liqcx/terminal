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

/** Задержка цены превью на вкладке Market: поток марка (~250 мс) иначе гонял бы мультиколлу на каждый тик. */
export const MARK_DEBOUNCE_MS = 2000;

/**
 * Цена, по которой спрашивается превью контракта.
 *
 * @remarks Limit — введённая цена как есть, без задержки (`0n` — поля нет,
 * превью выключено). Market — марк, сглаженный `debouncedMark`: ключ запроса
 * несёт цену, и сырой марк на каждом тике сбрасывал бы строки в «—» и бил в RPC
 * шестью чтениями на сторону. Пока сглаженного марка ещё нет (`0n`, первый
 * кадр), берётся сырой: первое число не ждёт задержки.
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
