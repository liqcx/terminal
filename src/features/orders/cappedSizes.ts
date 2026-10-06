import { type GatewayOrder, type Position, positionBrackets } from "@liq/sdk";

/**
 * Скобки, которые исполнятся меньшим размером, чем подписаны.
 *
 * @remarks После частичного закрытия TP/SL подписан на старый размер, а движок
 * урезает reduce-only до позиции. Экран показывает то, что исполнится (TRM-21).
 * Скобкой считается только нога своей позиции (SDK 0.65.0, `positionBrackets`).
 *
 * @returns `orderId` → действующий размер; только урезанные.
 */
export function cappedSizes(
  positions: readonly Pick<Position, "marketId" | "size">[],
  conditional: readonly GatewayOrder[],
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const position of positions) {
    const { takeProfit, stopLoss } = positionBrackets(position, conditional);
    for (const b of [takeProfit, stopLoss]) {
      if (b && b.effectiveSize < b.size) out.set(b.orderId, b.effectiveSize);
    }
  }
  return out;
}
