import {
  type Bracket,
  type GatewayOrder,
  type Position,
  parseWadLoose,
  reduceOnlyLegs,
} from "@liq/sdk";

/** Исполнится ли скобка меньшим размером, чем подписана. */
export function isCapped(b: Bracket): boolean {
  return b.effectiveSize < b.size;
}

/**
 * Неисполненный остаток ордера: `remainingSize`, а пока его нет — `|sizeDelta|`.
 *
 * @remarks Та же арифметика, что в `reduceOnlyLegs` (SDK 0.66.0): без исполнений
 * шлюз отдаёт `remainingSize` пустым, и остаток равен подписанному размеру.
 */
function remainingOf(order: GatewayOrder): bigint {
  const raw = parseWadLoose(order.remainingSize ?? order.sizeDelta);
  return raw < 0n ? -raw : raw;
}

/**
 * Reduce-only ордера, которые позиция урежет: исполнятся меньше, чем осталось.
 *
 * @remarks Движок урезает reduce-only до позиции. Экран показывает то, что
 * исполнится: TP/SL после частичного закрытия (TRM-21), reduce-only лимитку
 * больше позиции и вторую ногу того же вида (TRM-48). Ноги — `reduceOnlyLegs`
 * (SDK 0.66.0); резерв уже сматченных, но не рассчитанных он не учитывает.
 * Урезанной считается нога, чей действующий размер меньше её *остатка*, а не
 * подписанного размера: частично исполненная лимитка с остатком меньше позиции
 * не урезана — её размер уменьшило исполнение, а не позиция. Дубли по `id` SDK
 * снимает сам, побеждает первое вхождение: свежий список — открытые ордера —
 * подают первым; остаток здесь берётся у того же первого вхождения.
 *
 * @param orders - открытые и условные ордера счёта.
 * @returns `orderId` → действующий размер; только урезанные позицией.
 */
export function cappedSizes(
  positions: readonly Pick<Position, "marketId" | "size">[],
  orders: readonly GatewayOrder[],
): Map<string, bigint> {
  const firstById = new Map<string, GatewayOrder>();
  for (const order of orders) {
    if (!firstById.has(order.id)) firstById.set(order.id, order);
  }
  const out = new Map<string, bigint>();
  for (const position of positions) {
    for (const leg of reduceOnlyLegs(position, orders)) {
      const order = firstById.get(leg.orderId);
      const remaining = order ? remainingOf(order) : leg.size;
      if (leg.effectiveSize < remaining) out.set(leg.orderId, leg.effectiveSize);
    }
  }
  return out;
}
