import { Side } from "@liq/sdk";
import { formatQty, parseWadLoose } from "@liq/core";
import { createColumnHelper } from "@tanstack/react-table";

import { DataTable, MARKET_COLUMN_ID } from "@/components/data-table/DataTable";
import { features, marketFilterFn } from "@/components/data-table/features";

import { DASH, fmtPrice, fmtTime } from "../../lib/format";
import { type OrderRow, useOpenOrderRows } from "./useOpenOrderRows";

const helper = createColumnHelper<typeof features, OrderRow>();

const columns = helper.columns([
  helper.accessor((r) => Date.parse(r.order.createdAt), {
    id: "time",
    header: "Time",
    cell: (info) => (
      <span className="text-muted">{fmtTime(info.getValue())}</span>
    ),
  }),
  helper.accessor((r) => r.symbol, {
    id: MARKET_COLUMN_ID,
    header: "Market",
    enableHiding: false,
    filterFn: (row, _id, value) =>
      marketFilterFn(row.original.order.marketId, value),
    cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
  }),
  helper.accessor((r) => r.order.orderType, {
    id: "type",
    header: "Type",
    cell: (info) => <span className="text-muted">{info.getValue()}</span>,
  }),
  helper.accessor((r) => r.order.side, {
    id: "side",
    header: "Side",
    cell: (info) => (
      <span
        className={info.getValue() === Side.BUY ? "text-long" : "text-short"}
      >
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor((r) => Number(parseWadLoose(r.order.sizeDelta)), {
    id: "size",
    header: "Size",
    cell: (info) => {
      const size = parseWadLoose(info.row.original.order.sizeDelta);
      return formatQty(size < 0n ? -size : size);
    },
  }),
  helper.accessor((r) => Number(parseWadLoose(r.order.limitPrice ?? "0")), {
    id: "price",
    header: "Price",
    // Шлюз отдаёт крупные цены в научной нотации («1e+21»); parseWadLoose её
    // терпит там, где голый BigInt() уронил бы рендер без error boundary.
    cell: (info) => {
      const px = info.row.original.order.limitPrice;
      return px && px !== "0" ? fmtPrice(parseWadLoose(px)) : DASH;
    },
  }),
  helper.accessor((r) => Number(parseWadLoose(r.order.triggerPrice ?? "0")), {
    id: "trigger",
    header: "Trigger",
    cell: (info) => {
      const px = info.row.original.order.triggerPrice;
      return px && px !== "0" ? fmtPrice(parseWadLoose(px)) : DASH;
    },
  }),
  helper.accessor((r) => r.order.status, {
    id: "status",
    header: "Status",
    cell: (info) => <span className="text-muted">{info.getValue()}</span>,
  }),
  helper.display({
    id: "actions",
    header: "",
    enableHiding: false,
    cell: (info) => {
      const r = info.row.original;
      return (
        <button
          type="button"
          className="text-[11px] text-short disabled:opacity-50"
          disabled={r.cancelling || !r.cancellable}
          // Причина словами: выключенная кнопка без объяснения читается как
          // поломка экрана, а не как состояние ордера.
          title={
            r.cancellable
              ? undefined
              : r.order.status === "TRIGGERED"
                ? "Order triggered and is executing — too late to cancel"
                : "Order is settling — too late to cancel"
          }
          onClick={() => r.cancel(r.order.id)}
          data-testid={`cancel-order-${r.order.id}`}
        >
          Cancel
        </button>
      );
    },
  }),
]);

export function OpenOrdersTable() {
  const { rows, isLoading } = useOpenOrderRows();

  return (
    <DataTable
      data={rows}
      columns={columns}
      testid="orders-table"
      rowId={(r) => r.order.id}
      loading={isLoading}
      emptyText="No open orders."
    />
  );
}
