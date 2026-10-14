import { formatPrice, formatRatio, formatUsd, wadToNumber } from "@liq/core";

/**
 * Здесь только то, чего нет в `@liq/core`: деньги, количества, разбор WAD и
 * адреса печатает SDK (`formatUsd`, `formatQty`, `parseWadLoose`, `wadToFixed`,
 * `truncateAddress`, `sanitizeDecimal`) — стакан и таблицы говорят одним языком.
 */

/** Прочерк — единственное написание «данных нет» на экране. */
export const DASH = "—";

/**
 * Цена в таблицах и шапке: без `$` (валюту называет заголовок колонки) и без
 * обязательных копеек — «69,900», а не «$69,900.00».
 */
export function fmtPrice(v: bigint): string {
  return formatPrice(v, { sign: "", minDecimals: 0 });
}

/** «+$12.34» / «-$12.34»: SDK ставит только минус, плюс дописывается здесь. */
export function fmtSignedUsd(v: bigint): string {
  return (v < 0n ? "" : "+") + formatUsd(v);
}

/** WAD-доля (1e18 = 100%) со знаком: «+1.23%». */
export function fmtSignedPct(ratio: bigint): string {
  return (ratio < 0n ? "" : "+") + formatRatio(ratio);
}

/**
 * WAD-плечо: «0.00x», «3.50x», «10.00x» — всегда два знака.
 *
 * @remarks Одно написание на экран: карточка счёта и Overview печатали одно и
 * то же значение по-разному («0.00» и «0x», TRM-16).
 */
export function fmtLeverage(wad: bigint): string {
  return `${wadToNumber(wad).toFixed(2)}x`;
}

/**
 * Подпись при `available: false` у портфеля шлюза.
 *
 * @remarks Флаг значит «сабграф не ответил, история депозитов и выводов не
 * прочитана», а не «депозиты и выводы недоступны»: кнопки Deposit / Withdraw от
 * него не зависят и работают. Прежняя подпись читалась как запрет вывода (TRM-16).
 */
export const EVENTS_UNAVAILABLE =
  "Deposit and withdrawal history is unavailable right now";

/** Unix-миллисекунды → «02.09 14:35» в локали пользователя. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Число из поля ввода: пустое или неразборчивое — `0n`, то есть «не введено».
 *
 * @remarks `Price.parse("")` уже отдаёт `0n`; try/catch — на мусор, который
 * поле по идее не пропускает, но проверка на границе с пользователем остаётся.
 */
export function parseOrZero(
  parse: (raw: string) => bigint,
  raw: string,
): bigint {
  try {
    return parse(raw);
  } catch {
    return 0n;
  }
}

/**
 * Портфель шлюза (`/accounts/:id/portfolio`) отдаёт decimal-`number`, а не
 * WAD, — единственное место, где терминал печатает не bigint. Формат тот же,
 * что у `formatUsd` SDK: `$1,234.50`.
 */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtUsdNum(n: number): string {
  return USD.format(n === 0 ? 0 : n);
}

/** «+$1,923.40» / «-$500.00»; ноль (и минус-ноль) — без знака. */
export function fmtSignedUsdNum(n: number): string {
  const v = n === 0 ? 0 : n;
  return (v > 0 ? "+" : "") + USD.format(v);
}

/** Доля → «28.6%» (один знак): уровень использования маржи. */
export function fmtPctNum(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Доля со знаком → «+2.03%» (два знака): изменение PnL. */
export function fmtSignedPctNum(ratio: number): string {
  const pct = ratio * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
