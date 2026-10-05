import {
  describeOrderOutcome,
  type GatewayOrder,
  type OrderUpdateData,
} from "@liq/core";

import type { AppToast } from "../../stores/useToastStore";
import { marketSymbol } from "../market/useSelectedMarket";

/**
 * Тост на обновление ордера или `null`, если показывать нечего.
 *
 * @remarks `shown` — ключи `orderId:status` уже показанных исходов: повтор
 * после закрытия тоста молчит (в сторе дубль гасится, только пока тост на
 * экране). Ключ пишется лишь для исхода, у которого есть тост: голый
 * `CANCELLED` (отмена самим пользователем) не должен заглушить последующий
 * `CANCELLED` с причиной. Подпись ордера (сторона и рынок) — из `known`;
 * ордера нет в кешах — тост без подписи.
 */
export function outcomeToast(
  update: OrderUpdateData,
  known: ReadonlyMap<string, GatewayOrder>,
  shown: Set<string>,
  markets: readonly { id: bigint; symbol: string }[],
): AppToast | null {
  const key = `${update.orderId}:${update.status}`;
  if (shown.has(key)) return null;
  const order = known.get(update.orderId);
  const outcome = describeOrderOutcome(update, order);
  if (outcome === null) return null;
  shown.add(key);
  return {
    id: key,
    ...outcome,
    meta:
      order === undefined
        ? undefined
        : `${order.side} · ${marketSymbol(markets, order.marketId)}`,
  };
}
