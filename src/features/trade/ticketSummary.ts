import { type Qty, Side, sizeDelta, sizeToUsd, type Price, type Usd } from "@liq/sdk";

/** Одна сторона предполагаемого ордера. */
interface TicketSide {
  /** Знаковый размер: положительный — лонг, отрицательный — шорт. */
  sizeDelta: Qty;
}

/** Сводка тикета: общая часть плюс знаковый размер на каждый исход. */
export interface TicketSummary {
  /** Величина без знака — одна на обе стороны. */
  qty: Qty;
  /** Объём в USD по марку. */
  value: Usd;
  long: TicketSide;
  short: TicketSide;
}

/**
 * Обе стороны одного черновика разом.
 *
 * @remarks
 * Здесь только то, что считается из размера и марка. Маржа и ликвидация —
 * числа протокола, их даёт превью контракта по цене вкладки
 * (`useOrderMarginPreview`, см. `useOrderSizing`); локальная оценка по плечу
 * рядом с ними выдавала бы второе, расходящееся число. Плечо остаётся только
 * калькулятором размера (`sizeFromLeverage`).
 */
export function ticketSummary(input: {
  sizeQty: Qty;
  markPrice: Price;
}): TicketSummary {
  const { sizeQty, markPrice } = input;
  // Без марка `sizeToUsd` сам отдаёт ноль — тернарник на `markPrice > 0n` был
  // бы веткой, которую ничем не отличить от её отсутствия.
  return {
    qty: sizeQty,
    value: sizeToUsd(sizeQty, markPrice),
    long: { sizeDelta: sizeDelta(sizeQty, Side.BUY) },
    short: { sizeDelta: sizeDelta(sizeQty, Side.SELL) },
  };
}
