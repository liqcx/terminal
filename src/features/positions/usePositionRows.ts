import {
  type GatewayOrder,
  type PositionBrackets,
  positionBrackets,
  Price,
  type Qty,
  type ReduceOnlyLeg,
  reduceOnlyLegs,
} from "@liq/sdk";
import {
  useAccountId,
  useClosePositions,
  useConditionalOrders,
  useEnrichedPositions,
  useOpenOrdersQuery,
  usePricesQuery,
} from "@liq/react";
import { useCallback, useMemo } from "react";

import { mergeById } from "../orders/useOpenOrderRows";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";

type EnrichedPosition = NonNullable<
  ReturnType<typeof useEnrichedPositions>["data"]
>[number];

/** Строка таблицы позиций: позиция плюс то, что приклеено с других запросов. */
export interface PositionRow {
  position: EnrichedPosition;
  symbol: string;
  markPrice: bigint | undefined;
  /**
   * TP и SL позиции — каждый со своим идентификатором заявки.
   *
   * @remarks Идентификатор здесь не для показа: замена скобки — это отмена
   * конкретного условного ордера, и без него правка ищет заявку заново.
   */
  brackets: PositionBrackets;
  /**
   * Все reduce-only ордера позиции: оба вида TP/SL и reduce-only лимитки.
   *
   * @remarks Их снимает backend при закрытии позиции (Ф2, Ф3), поэтому диалог
   * Close считает именно `legs`, а не `brackets`: скобок в строке не больше
   * двух, а ног может быть сколько угодно (TRM-57).
   */
  legs: ReduceOnlyLeg[];
}

/** Чем кончился проход закрытия. */
interface CloseOutcome {
  closed: number;
  failed: number;
}

interface PriceEntry {
  price: bigint;
}

/**
 * Сборка строк — отдельно от хука, чтобы её можно было проверить без React.
 *
 * @remarks Позиция здесь описана двумя полями: рынок и знаковый размер. Рынок
 * нужен, чтобы найти символ, цену и скобки; знак размера говорит, какая нога
 * закрывает позицию, а модуль — сколько из подписанного размера скобки
 * исполнится.
 */
export function buildPositionRows<P extends { marketId: bigint; size: Qty }>(input: {
  positions: readonly P[];
  markets: readonly { id: bigint; symbol: string }[];
  prices: Record<string, PriceEntry | undefined> | undefined;
  /** Открытые и условные ордера счёта; открытые первыми (`mergeById`). */
  orders: readonly GatewayOrder[];
}): {
  position: P;
  symbol: string;
  markPrice: bigint | undefined;
  brackets: PositionBrackets;
  legs: ReduceOnlyLeg[];
}[] {
  return input.positions.map((position) => {
    const key = position.marketId.toString();
    return {
      position,
      symbol: marketSymbol(input.markets, position.marketId),
      markPrice: input.prices?.[key]?.price,
      // Позиция целиком, а не рынок: скобкой считается только нога, которая
      // эту позицию закрывает (SDK 0.65.0). Раньше сирота закрытой позиции
      // становилась «стопом» следующей, и редактор отменял её (TRM-9).
      brackets: positionBrackets(position, input.orders),
      legs: reduceOnlyLegs(position, input.orders),
    };
  });
}

/**
 * Строки таблицы позиций и действия над ними.
 *
 * @remarks Закрытие — одна подача на позицию. Скобки закрытой позиции
 * снимает backend в транзакции расчёта, который её закрыл (`CANCELLED`,
 * причина `position_closed`; трейдер видит тост). Терминал раньше снимал их
 * сам и до подачи: неисполненное закрытие оставляло позицию без защиты.
 * Reduce-only ордера позиции (TP/SL и reduce-only лимитки) снимает backend
 * при закрытии (Ф2, Ф3); обычные лимитки не трогаются.
 */
export function usePositionRows(): {
  rows: PositionRow[];
  isLoading: boolean;
  isError: boolean;
  close: (rows: readonly PositionRow[]) => Promise<CloseOutcome>;
  isClosing: boolean;
} {
  const { markets, allMarketIds } = useSelectedMarket();
  const accountId = useAccountId();
  const {
    data: positions = EMPTY_POSITIONS,
    isLoading,
    isError,
  } = useEnrichedPositions(allMarketIds);
  const { data: prices } = usePricesQuery(allMarketIds);
  const { data: open = EMPTY_ORDERS } = useOpenOrdersQuery(accountId);
  const { data: conditional = EMPTY_ORDERS } = useConditionalOrders();
  const { close: closePositions, isPending: isClosing } =
    useClosePositions(accountId);

  // Открытые первыми: при дубле по id SDK берёт первое вхождение.
  const orders = useMemo(() => mergeById(open, conditional), [open, conditional]);

  const rows = useMemo<PositionRow[]>(
    () =>
      buildPositionRows({
        positions,
        markets,
        prices,
        orders,
      }),
    [positions, markets, prices, orders],
  );

  const close = useCallback(
    async (target: readonly PositionRow[]): Promise<CloseOutcome> => {
      const { closed, failed } = await closePositions(
        target.map((r) => ({
          position: r.position,
          markPrice: Price(r.markPrice ?? 0n),
        })),
      );
      return { closed, failed };
    },
    [closePositions],
  );

  return { rows, isLoading, isError, close, isClosing };
}

const EMPTY_POSITIONS: EnrichedPosition[] = [];
const EMPTY_ORDERS: GatewayOrder[] = [];
