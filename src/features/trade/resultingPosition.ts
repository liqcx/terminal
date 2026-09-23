import { Qty, Side, toSignedSize } from "@liq/sdk";

/**
 * Позиция, которой станет рынок после входа этой стороной.
 *
 * @remarks Скобки ставятся на позицию, а не на вход: у лонга 2 и продажи 1
 * рынок остаётся длинным, и TP по-прежнему обязан стоять выше цены. Сторона
 * нажатой кнопки здесь лжёт — считать надо результат.
 *
 * Один расчёт на гейт кнопок и на подачу: разойдясь, они дали бы активную
 * кнопку, чьи скобки действие тут же отклонит — уже после принятого входа.
 *
 * Знак приводит `toSignedSize`: часть источников несёт размер по модулю.
 * Нулевой размер (полное закрытие) — не особый случай: ног у такой позиции
 * нет, и `bracketsPlanFor` ничего не отклоняет.
 */
export function resultingPosition(
  marketId: bigint,
  open: { size: bigint; side: Side } | undefined,
  entryDelta: Qty,
): { marketId: bigint; side: Side; size: Qty } {
  const size = Qty(
    (open ? toSignedSize(Qty(open.size), open.side) : 0n) + entryDelta,
  );
  return { marketId, side: size < 0n ? Side.SELL : Side.BUY, size };
}
