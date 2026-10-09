import { formatQty, formatUsd } from "@liq/core";
import type { RowsView } from "./orderMarginView";
import type { TicketSummary } from "./ticketSummary";

/**
 * Сводка тикета.
 *
 * @remarks Количество и объём у обеих сторон одинаковы — это один расчёт, и
 * печатается он один раз. Пара «зелёное / красное» — у `Margin` и `Liq. Price`:
 * строк, где лонг и шорт дают разные числа протокола. `Margin` — то, что
 * заблокирует шлюз под сторону, `max(0, R1 − R0)`; обе строки приходят из
 * превью контракта по цене вкладки.
 *
 * Блок показан всегда, а не от непустого размера: сторона выбирается
 * нажатием кнопки, и сводка — единственное место, где видно, чем два нажатия
 * различаются. Появляясь только с размером, она прятала бы это различие ровно
 * тогда, когда его и разглядывают.
 */
export function OrderSummary({
  summary,
  rows,
  baseSymbol,
  quoteSymbol,
}: {
  summary: TicketSummary;
  rows: RowsView;
  baseSymbol: string;
  quoteSymbol: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface-2 p-1.5 text-[10px]"
      data-testid="order-summary"
    >
      <Row label="Order qty." value={formatQty(summary.qty)} unit={baseSymbol} testid="order-qty" />
      <Row label="Order value" value={formatUsd(summary.value)} unit={quoteSymbol} testid="order-value" />
      <SidesRow label="Margin" sides={rows.margin} testid="order-margin" />
      <SidesRow label="Liq. Price" sides={rows.liqPrice} testid="order-liq-price" />
    </div>
  );
}

function SidesRow({
  label,
  sides,
  testid,
}: {
  label: string;
  sides: { long: string; short: string };
  testid: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span data-testid={testid}>
        <span className="text-long">{sides.long}</span>
        <span className="text-muted"> / </span>
        <span className="text-short">{sides.short}</span>
      </span>
    </div>
  );
}

function Row({
  label,
  value,
  unit,
  testid,
}: {
  label: string;
  value: string;
  unit: string;
  testid: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span data-testid={testid}>
        <span className="text-text">{value}</span>
        <span className="text-muted"> {unit}</span>
      </span>
    </div>
  );
}
