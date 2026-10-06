import {
  type GatewayOrder,
  type PositionBrackets,
  positionBrackets,
  Price,
  type Qty,
} from "@liq/sdk";
import {
  useAccountId,
  useCancelOrdersMutation,
  useClosePositions,
  useConditionalOrders,
  useEnrichedPositions,
  usePricesQuery,
} from "@liq/react";
import { useCallback, useMemo } from "react";

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
}

/** Чем кончился проход закрытия. */
interface CloseOutcome {
  closed: number;
  failed: number;
  /** Скобки закрытых позиций, снятые заодно. */
  cancelled: number;
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
  conditional: readonly GatewayOrder[];
}): { position: P; symbol: string; markPrice: bigint | undefined; brackets: PositionBrackets }[] {
  return input.positions.map((position) => {
    const key = position.marketId.toString();
    return {
      position,
      symbol: marketSymbol(input.markets, position.marketId),
      markPrice: input.prices?.[key]?.price,
      // Позиция целиком, а не рынок: скобкой считается только нога, которая
      // эту позицию закрывает (SDK 0.65.0). Раньше сирота закрытой позиции
      // становилась «стопом» следующей, и редактор отменял её (TRM-9).
      brackets: positionBrackets(position, input.conditional),
    };
  });
}

/**
 * Строки таблицы позиций и действия над ними.
 *
 * @remarks Закрытие снимает и скобки закрываемых позиций: reduce-only триггер
 * осиротевшей позиции исполниться не может, но в списке условных остаётся и
 * читается как живой. Отдыхающие лимитные ордера не трогаются — их закрытие
 * позиции не просило (в Liqu «Close All» отменяет и их; здесь это осознанно
 * иначе, чтобы кнопка отвечала своей подписи).
 *
 * Сначала отмена, потом закрытие: скобка, сработавшая между этими шагами, сама
 * уменьшила бы позицию, и закрывающий ордер ушёл бы на размер, которого уже нет.
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
  const { data: conditional = EMPTY_ORDERS } = useConditionalOrders();
  const cancelOrders = useCancelOrdersMutation(accountId);
  const { close: closePositions, isPending: isClosing } =
    useClosePositions(accountId);

  const rows = useMemo<PositionRow[]>(
    () =>
      buildPositionRows({
        positions,
        markets,
        prices,
        conditional,
      }),
    [positions, markets, prices, conditional],
  );

  const close = useCallback(
    async (target: readonly PositionRow[]): Promise<CloseOutcome> => {
      const bracketIds = target.flatMap((r) =>
        [r.brackets.takeProfit?.orderId, r.brackets.stopLoss?.orderId].filter(
          (id): id is string => id !== undefined,
        ),
      );

      let cancelled = 0;
      if (bracketIds.length > 0) {
        try {
          const results = await cancelOrders.mutateAsync(bracketIds);
          cancelled = results.filter((r) => r.status === "CANCELLED").length;
        } catch {
          // Скобку снять не удалось — позицию всё равно закрываем: осиротевший
          // reduce-only триггер безвреден, незакрытая позиция нет.
          cancelled = 0;
        }
      }

      const { closed, failed } = await closePositions(
        target.map((r) => ({
          position: r.position,
          markPrice: Price(r.markPrice ?? 0n),
        })),
      );

      return { closed, failed, cancelled };
    },
    [cancelOrders, closePositions],
  );

  return { rows, isLoading, isError, close, isClosing };
}

const EMPTY_POSITIONS: EnrichedPosition[] = [];
const EMPTY_ORDERS: GatewayOrder[] = [];
