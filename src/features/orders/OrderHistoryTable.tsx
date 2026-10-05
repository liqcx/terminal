import type { GatewayOrder } from "@liq/core";
import { useAccountId, useOrderHistoryQuery } from "@liq/react";
import { Side } from "@liq/sdk";
import { formatQty, parseWadLoose } from "@liq/core";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";

import { DataTable, MARKET_COLUMN_ID } from "@/components/data-table/DataTable";
import { features, marketFilterFn } from "@/components/data-table/features";

import { DASH, fmtPrice, fmtTime } from "../../lib/format";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";

interface Row {
  order: GatewayOrder;
  symbol: string;
}

const helper = createColumnHelper<typeof features, Row>();

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
    cell: (info) => {
      const px = info.row.original.order.limitPrice;
      return px && px !== "0" ? fmtPrice(parseWadLoose(px)) : DASH;
    },
  }),
  helper.accessor((r) => r.order.status, {
    id: "status",
    header: "Status",
    cell: (info) => <span className="text-muted">{info.getValue()}</span>,
  }),
]);

/**
 * Ордера, вышедшие из конвейера матчинга.
 *
 * @remarks Хук спрашивает `TERMINAL_ORDER_STATUSES`. Вместе с
 * `OPEN_ORDER_STATUSES`, которыми живёт вкладка Open Orders, это не все
 * статусы: ордера в полёте (`MATCHED`, `SETTLEMENT_SUBMITTED`,
 * `FAILED_RETRYABLE`, с SDK 0.64.0 и `TRIGGERED`) живут во вкладке Open Orders
 * с погашенной отменой (`isInFlight`), а не здесь; в историю они попадают,
 * когда получат исход.
 */
export function OrderHistoryTable() {
  const { markets } = useSelectedMarket();
  const accountId = useAccountId();
  const { data = EMPTY, isLoading } = useOrderHistoryQuery(accountId);

  const rows = useMemo<Row[]>(
    () =>
      data.map((order) => ({
        order,
        symbol: marketSymbol(markets, order.marketId),
      })),
    [data, markets],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      testid="order-history-table"
      rowId={(r) => r.order.id}
      loading={isLoading}
      emptyText="No past orders."
    />
  );
}

const EMPTY: GatewayOrder[] = [];
