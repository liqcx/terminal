import type { GatewayOrder } from "@liq/sdk";

/**
 * Открытые и условные ордера без дублей по id.
 *
 * @remarks Сработавший TP/SL недолго числится в обоих списках: открытый
 * (опрос 10 с, с SDK 0.64.0 несёт `TRIGGERED`) обновился, условный (опрос 60 с)
 * ещё держит `TRIGGER_PENDING`. Побеждает запись открытого списка — у неё
 * свежее состояние, иначе рядом с `TRIGGERED` жила бы строка с живой отменой.
 */
export function mergeById(
  open: readonly GatewayOrder[],
  conditional: readonly GatewayOrder[],
): GatewayOrder[] {
  const seen = new Set(open.map((o) => o.id));
  return [...open, ...conditional.filter((o) => !seen.has(o.id))];
}
