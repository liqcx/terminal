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
import { mergeById } from "./mergeById";

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
   * Сколько исполнит reduce-only ордер, если меньше подписанного; `undefined` — не урезан.
   *
   * @remarks Движок урезает reduce-only до позиции; после частичного закрытия
   * подписанный размер больше того, что исполнится (TRM-21). Касается любого
   * reduce-only ордера позиции: TP/SL (обе ноги) и reduce-only лимитки (TRM-48).
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
  // общего кэша, второго обращения к RPC нет.
  const { data: positions = EMPTY_POSITIONS } =
    useEnrichedPositions(allMarketIds);
  // Отмена в SDK инвалидирует оба списка (monorepo#453), поэтому здесь ничего
  // инвалидировать не надо.
  const cancel = useCancelOrderMutation(accountId);

  // Открытые первыми: `reduceOnlyLegs` при дубле по id берёт первое вхождение.
  const merged = useMemo(() => mergeById(open, conditional), [open, conditional]);

  const capped = useMemo(
    () => cappedSizes(positions, merged),
    [positions, merged],
  );

  const rows = useMemo<OrderRow[]>(
    () =>
      merged.map((order) => ({
        order,
        symbol: marketSymbol(markets, order.marketId),
        cancel: (id: string) => cancel.mutate(id),
        cancelling: cancel.isPending,
        cancellable: !isInFlight(order.status),
        cappedSize: capped.get(order.id),
      })),
    [merged, markets, cancel, capped],
  );

  return { rows, isLoading };
}

const EMPTY: GatewayOrder[] = [];
const EMPTY_POSITIONS: NonNullable<
  ReturnType<typeof useEnrichedPositions>["data"]
> = [];
