import {
  type Bracket,
  type GatewayOrder,
  type Position,
  reduceOnlyLegs,
} from "@liq/sdk";

/** Исполнится ли скобка меньшим размером, чем подписана. */
export function isCapped(b: Bracket): boolean {
  return b.effectiveSize < b.size;
}

/**
 * Reduce-only ордера, которые исполнятся меньшим размером, чем подписаны.
 *
 * @remarks Движок урезает reduce-only до позиции. Экран показывает то, что
 * исполнится: TP/SL после частичного закрытия (TRM-21), reduce-only лимитку
 * больше позиции и вторую ногу того же вида (TRM-48). Ноги — `reduceOnlyLegs`
 * (SDK 0.66.0); резерв уже сматченных, но не рассчитанных он не учитывает.
 * Дубли по `id` SDK снимает сам, побеждает первое вхождение: свежий список —
 * открытые ордера — подают первым.
 *
 * @param orders - открытые и условные ордера счёта.
 * @returns `orderId` → действующий размер; только урезанные.
 */
export function cappedSizes(
  positions: readonly Pick<Position, "marketId" | "size">[],
  orders: readonly GatewayOrder[],
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const position of positions) {
    for (const leg of reduceOnlyLegs(position, orders)) {
      if (leg.effectiveSize < leg.size) out.set(leg.orderId, leg.effectiveSize);
    }
  }
  return out;
}
