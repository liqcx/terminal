import { describeOrderOutcome, type GatewayOrder } from "@liq/core";
import {
  useAccountId,
  useAccountOrderUpdates,
  useConditionalOrders,
  useOpenOrdersQuery,
} from "@liq/react";
import { useEffect, useRef } from "react";

import { useToastStore } from "../../stores/useToastStore";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";

/**
 * Исход ордера — тостом: провал, отмена, которую назвал сервер, истечение,
 * сброс условного ордера (TRM-43).
 *
 * @remarks Слова — `describeOrderOutcome` из SDK; терминал добавляет только
 * подпись ордера (сторона и рынок) из кешей открытых и условных ордеров.
 * Кеш накопительный: исход приходит, когда ордер уже ушёл из открытого
 * списка, — подпись берётся из того, что видели раньше. Ордера в кешах не
 * было (сработавший TP/SL между опросами) — тост без подписи.
 *
 * Дубль `(orderId, status)` гасится здесь, а не в SDK: шлюз зеркалит в канал
 * счёта два броадкаста одного исхода, а устаревание повтор переживает.
 */
export function useOrderOutcomeToasts(): void {
  const accountId = useAccountId();
  const { data: open } = useOpenOrdersQuery(accountId);
  const { data: conditional } = useConditionalOrders();
  const { markets } = useSelectedMarket();
  const push = useToastStore((s) => s.push);

  const known = useRef(new Map<string, GatewayOrder>());
  const shown = useRef(new Set<string>());
  const marketsRef = useRef(markets);

  useEffect(() => {
    for (const order of [...(open ?? []), ...(conditional ?? [])]) {
      known.current.set(order.id, order);
    }
  }, [open, conditional]);

  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useAccountOrderUpdates((update) => {
    const key = `${update.orderId}:${update.status}`;
    if (shown.current.has(key)) return;
    const order = known.current.get(update.orderId);
    const outcome = describeOrderOutcome(update, order);
    if (outcome === null) return;
    shown.current.add(key);
    push({
      id: key,
      ...outcome,
      meta:
        order === undefined
          ? undefined
          : `${order.side} · ${marketSymbol(marketsRef.current, order.marketId)}`,
    });
  });
}
