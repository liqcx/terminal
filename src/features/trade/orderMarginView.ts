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
  /** Цифры удержаны с прошлого чтения, новое ещё в пути ({@link holdPreviewStep}). */
  stale?: boolean;
}

/** Две строки сводки, по строке на сторону. */
export interface RowsView {
  margin: { long: string; short: string };
  liqPrice: { long: string; short: string };
  /** Сторона показывает удержанные цифры и пересчитывается — строки приглушаются. */
  stale: { long: boolean; short: boolean };
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
    stale: {
      long: input.long.stale === true,
      short: input.short.stale === true,
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
 * запрос; строки при этом не гаснут в «—», а удерживают прежние цифры тусклыми,
 * пока читается новая цена ({@link holdPreviewStep}). Задержка откладывает эту
 * смену не дольше чем на {@link MARK_DEBOUNCE_MS}. Пока сглаженного марка ещё нет
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

/**
 * Ключ удержания цифр: аккаунт, рынок, единица и введённая строка размера.
 *
 * @remarks Каждая часть нужна: чужой аккаунт или рынок под тем же размером
 * показали бы чужие цифры. Цена в ключ не входит — удержание и существует ради
 * сдвига одной только цены. Выведенный `sizeDelta` тоже не входит: в USD он
 * дрожит вместе с маркой. `undefined` — «нет» (запрос выключен), отличимое от `0n`.
 */
export function heldPreviewKey(input: {
  accountId: bigint | undefined;
  marketId: bigint | undefined;
  unit: string;
  sizeStr: string;
}): string {
  const { accountId, marketId, unit, sizeStr } = input;
  return `${accountId ?? ""}:${marketId ?? ""}:${unit}:${sizeStr}`;
}

/** Что превью отдало по одной стороне; `undefined` — не прочитано. */
export interface PreviewFigures {
  /** R1 — требование всего аккаунта после ордера. */
  r1: Margin | undefined;
  /** Оценка ликвидации; `null` — уровня нет, `undefined` — не прочитана. */
  liq: Price | null | undefined;
}

/** Последние прочитанные цифры стороны и ключ (аккаунт, рынок, размер), для которого они прочитаны. */
export interface HeldFigures {
  key: string;
  r1: Margin;
  liq: Price | null;
}

/** Что показывать: цифры и пометка, что они удержаны с прошлого чтения. */
export interface ShownFigures extends PreviewFigures {
  stale: boolean;
}

/**
 * Удержание цифр, пока двигается одна только цена или перечитывается кэш.
 *
 * @remarks У превью SDK нет TanStack `placeholderData`, а цена входит в ключ запроса:
 * каждая смена марка — новый ключ, и строки на круг RPC становились бы «—».
 * Пока читается тот же `key` (аккаунт, рынок, введённый размер с единицей), показываются
 * последние прочитанные цифры с пометкой `stale`. Другой ключ (сменился размер,
 * рынок или аккаунт), упавшее чтение и выключенный запрос (`inFlight` ложно, а
 * цифр нет) показывают `fresh` — «не прочитано»: чужая цифра под новым ордером
 * соврала бы.
 *
 * `refreshing` — у запроса есть данные, и он их перечитывает (`isFetching` при
 * `data`): так происходит после сброса кэша при смене счёта
 * ({@link accountStateChanged}). TanStack в этот момент оставляет прежний `data`
 * и `isLoading` ложно, и цифры от до-филла показались бы свежими; с `refreshing`
 * они остаются, но помечены `stale` и тускнеют, пока не придёт новое чтение.
 * Прочитанное `fresh` вне перечитывания всегда выигрывает у удержанного.
 *
 * Возвращает следующее удержанное состояние (тот же объект, пока ничего не
 * изменилось) и то, что показать.
 */
export function holdPreviewStep(
  held: HeldFigures | undefined,
  key: string,
  fresh: PreviewFigures,
  inFlight: boolean,
  refreshing = false,
): { held: HeldFigures | undefined; shown: ShownFigures } {
  if (fresh.r1 !== undefined) {
    const liq = fresh.liq ?? null;
    const next =
      held !== undefined &&
      held.key === key &&
      held.r1 === fresh.r1 &&
      held.liq === liq
        ? held
        : { key, r1: fresh.r1, liq };
    return {
      held: next,
      shown: { r1: fresh.r1, liq, stale: refreshing },
    };
  }
  if (held !== undefined && held.key === key && inFlight) {
    return { held, shown: { r1: held.r1, liq: held.liq, stale: true } };
  }
  return { held: undefined, shown: { ...fresh, stale: false } };
}

/** Часть состояния счёта, от которой зависит превью ордера. */
export interface AccountState {
  /** R0 — `requiredInitialMargin` счёта на цепочке; `undefined` — не прочитан. */
  r0: bigint | undefined;
  /** `locked` шлюза; `undefined` — не прочитан (чтение шлюза требует входа). */
  locked: bigint | undefined;
  /**
   * Сумма коллатерала счёта, WAD; `undefined` — не прочитана целиком. Меняется
   * только депозитом, выводом и погашением — дискретно, в отличие от
   * `available`, который двигается вместе с PnL.
   */
  collateral: bigint | undefined;
  /** Долг счёта; `undefined` — не прочитан. */
  debt: bigint | undefined;
}

const ACCOUNT_STATE_FIELDS = ["r0", "locked", "collateral", "debt"] as const;

/**
 * Изменилось ли состояние счёта настолько, что кэш превью надо сбросить.
 *
 * @remarks Превью SDK (`orderMarginPreview`) не помечается устаревшим ничем
 * (`dirtiedBy: []`, без `refetchInterval`). Филл двигает R0 (`useMarginUsage`
 * перечитывает его по событиям и каждые 10 с), и в Margin = `max(0, R1 − R0)`
 * попал бы R1 до филла против R0 после. Депозит, вывод и погашение не двигают ни
 * R0, ни `locked`, но сдвигают уровень ликвидации — их ловит сумма коллатерала
 * и долг. Сбрасывать нужно при смене любого известного значения из четырёх.
 * `available` сюда не входит нарочно: он двигается вместе с PnL, и превью
 * перечитывалось бы и тускнело каждые ~10 с.
 *
 * Неизвестное (`undefined`) ни с чем не сравнивается: первая загрузка не меняет
 * счёт, а пропавшее чтение — не повод перечитывать. `prev` — последние известные
 * значения ({@link foldAccountState}); `undefined` — предыдущего нет.
 * Сам сброс превью эти величины не двигает, так что обратной связи нет.
 */
export function accountStateChanged(
  prev: AccountState | undefined,
  next: AccountState,
): boolean {
  if (prev === undefined) return false;
  return ACCOUNT_STATE_FIELDS.some((f) => {
    const a = prev[f];
    const b = next[f];
    return a !== undefined && b !== undefined && a !== b;
  });
}

/**
 * Следующее запомненное состояние счёта и нужен ли сброс.
 *
 * @remarks Запоминаются последние *известные* значения по полям: поле, на миг
 * ставшее `undefined`, не должно стирать память, иначе следующее чтение
 * считалось бы «первой загрузкой» и пропустило изменение.
 */
export function foldAccountState(
  prev: AccountState | undefined,
  next: AccountState,
): { state: AccountState; changed: boolean } {
  return {
    state: {
      r0: next.r0 ?? prev?.r0,
      locked: next.locked ?? prev?.locked,
      collateral: next.collateral ?? prev?.collateral,
      debt: next.debt ?? prev?.debt,
    },
    changed: accountStateChanged(prev, next),
  };
}
