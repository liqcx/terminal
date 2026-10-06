import { type GatewayOrder, isInFlight } from "@liq/core";
import {
  useAccountId,
  useCancelOrderMutation,
  useConditionalOrders,
  useEnrichedPositions,
  useOpenOrdersQuery,
} from "@liq/react";
import { useMemo } from "react";

import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";
import { cappedSizes } from "./cappedSizes";

/** Строка таблицы открытых ордеров: ордер плюс подпись рынка и отмена. */
export interface OrderRow {
  order: GatewayOrder;
  symbol: string;
  cancel: (id: string) => void;
  cancelling: boolean;
  /**
   * Можно ли ещё отменить.
   *
   * @remarks Ордер в полёте (`MATCHED`, `SETTLEMENT_SUBMITTED`,
   * `FAILED_RETRYABLE`, а с SDK 0.64.0 и сработавший условный — `TRIGGERED`)
   * вышел из книги, но исхода ещё не получил: отменять нечего, отмена вернула
   * бы отказ шлюза. До SDK 0.46.0 такой ордер не попадал ни в открытый список,
   * ни в историю и просто исчезал с экрана между матчингом и сеттлментом;
   * теперь он виден — с выключенной отменой.
   */
  cancellable: boolean;
  /**
   * Сколько исполнит скобка, если меньше подписанного; `undefined` — не урезана.
   *
   * @remarks Движок урезает reduce-only до позиции; после частичного закрытия
   * подписанный размер больше того, что исполнится (TRM-21).
   */
  cappedSize?: bigint;
}

/** Открытые и условные ордера одной таблицей — как их видит трейдер. */
export function useOpenOrderRows(): {
  rows: OrderRow[];
  isLoading: boolean;
} {
  const { markets, allMarketIds } = useSelectedMarket();
  const accountId = useAccountId();
  const { data: open = EMPTY, isLoading } = useOpenOrdersQuery(accountId);
  const { data: conditional = EMPTY } = useConditionalOrders();
  // Тот же запрос, что у таблицы позиций и тикета: react-query отдаёт его из
  // общего кэша, второго обращения к шлюзу нет.
  const { data: positions = EMPTY_POSITIONS } =
    useEnrichedPositions(allMarketIds);
  // Отмена в SDK инвалидирует оба списка (monorepo#453), поэтому здесь ничего
  // инвалидировать не надо.
  const cancel = useCancelOrderMutation(accountId);

  const capped = useMemo(
    () => cappedSizes(positions, conditional),
    [positions, conditional],
  );

  const rows = useMemo<OrderRow[]>(
    () =>
      mergeById(open, conditional).map((order) => ({
        order,
        symbol: marketSymbol(markets, order.marketId),
        cancel: (id: string) => cancel.mutate(id),
        cancelling: cancel.isPending,
        cancellable: !isInFlight(order.status),
        cappedSize: capped.get(order.id),
      })),
    [open, conditional, markets, cancel, capped],
  );

  return { rows, isLoading };
}

/**
 * Открытые и условные ордера без дублей по id.
 *
 * @remarks Сработавший TP/SL недолго числится в обоих списках: открытый
 * (опрос 10 с, с SDK 0.64.0 несёт `TRIGGERED`) обновился, условный (опрос 60 с)
 * ещё держит `TRIGGER_PENDING`. Побеждает запись открытого списка — у неё
 * свежее состояние, иначе рядом с `TRIGGERED` жила бы строка с живой отменой.
 */
function mergeById(
  open: GatewayOrder[],
  conditional: GatewayOrder[],
): GatewayOrder[] {
  const seen = new Set(open.map((o) => o.id));
  return [...open, ...conditional.filter((o) => !seen.has(o.id))];
}

const EMPTY: GatewayOrder[] = [];
const EMPTY_POSITIONS: NonNullable<
  ReturnType<typeof useEnrichedPositions>["data"]
> = [];
