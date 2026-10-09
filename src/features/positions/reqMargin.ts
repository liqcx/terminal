import { formatUsd } from "@liq/core";
import type { Margin } from "@liq/sdk";

import { DASH } from "../../lib/format";

/**
 * Ячейка «Req. margin»: начальная маржа протокола под позицию.
 *
 * @remarks `undefined` — чтение не отдало величину (позиция собрана без
 * `requiredInitialMargin`): прочерк, а не `$0.00`, потому что ноль читался бы
 * как «протокол ничего не требует». `0n` — известное значение и печатается
 * как есть.
 */
export function reqMarginText(m: Margin | undefined): string {
  return m === undefined ? DASH : formatUsd(m);
}
