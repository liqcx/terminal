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
  /** Объём в USD по цене вкладки ({@link ticketPrice}). */
  value: Usd;
  long: TicketSide;
  short: TicketSide;
}

/**
 * Обе стороны одного черновика разом.
 *
 * @remarks
 * Здесь только то, что считается из размера и цены вкладки. Маржа и ликвидация —
 * числа протокола, их даёт превью контракта по цене вкладки
 * (`useOrderMarginPreview`, см. `useOrderSizing`); локальная оценка по плечу
 * рядом с ними выдавала бы второе, расходящееся число. Плечо остаётся только
 * калькулятором размера (`sizeFromLeverage`).
 */
export function ticketSummary(input: {
  sizeQty: Qty;
  /** Цена вкладки — {@link ticketPrice}. */
  price: Price;
}): TicketSummary {
  const { sizeQty, price } = input;
  // Без цены `sizeToUsd` сам отдаёт ноль — тернарник на `price > 0n` был
  // бы веткой, которую ничем не отличить от её отсутствия.
  return {
    qty: sizeQty,
    value: sizeToUsd(sizeQty, price),
    long: { sizeDelta: sizeDelta(sizeQty, Side.BUY) },
    short: { sizeDelta: sizeDelta(sizeQty, Side.SELL) },
  };
}

/**
 * Цена, по которой тикет переводит размер в доллары и обратно: Order value,
 * «≈ $» под количеством, ввод в USD и потолок размера по плечу.
 *
 * @remarks Market — марк. Limit — введённая цена: ордер исполнится по ней, и
 * объём по марку обещал бы другую сумму (TRM-36). Пока лимитной цены нет,
 * берётся марк — иначе пустое поле обнулило бы объём и размер в USD.
 */
export function ticketPrice(input: {
  tab: "Market" | "Limit";
  mark: bigint;
  limit: bigint;
}): bigint {
  return input.tab === "Limit" && input.limit > 0n ? input.limit : input.mark;
}
