import { wadToFixed } from "@liq/core";

import { priceDecimals } from "../../lib/format";

/**
 * Знаков в полях TP/SL позиции — по марку, а пока марк не пришёл, по цене входа.
 *
 * @remarks Диалог можно открыть раньше, чем загрузятся цены: без запасной цены
 * знаков было бы два, а XRP-триггер 1.5015 предзаполнился бы «1.5» (TRM-32).
 * Цена входа у позиции есть всегда и по порядку величины от марка не уходит.
 */
export function tpslDecimals(
  markPrice: bigint | undefined,
  entryPrice: bigint,
): number {
  return priceDecimals(markPrice ?? entryPrice);
}

/**
 * Значение поля TP/SL, предзаполненное текущим триггером.
 *
 * @remarks Начальное значение берётся один раз, при монтировании, поэтому
 * точность не может зависеть только от марка: пришёл он позже — «Save» без
 * правки сдвинул бы скобку на округление. Потому знаков не меньше, чем нужно
 * самому триггеру.
 */
export function tpslPrefill(trigger: bigint, decimals: number): string {
  return wadToFixed(trigger, Math.max(decimals, priceDecimals(trigger)));
}
