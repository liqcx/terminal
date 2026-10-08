import type { PositionEpisode } from "@liq/api-client";
import { useAccountId, usePositionHistoryQuery } from "@liq/react";
import { formatQty, formatUsd } from "@liq/core";
import { createColumnHelper } from "@tanstack/react-table";
import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { DataTable, MARKET_COLUMN_ID } from "@/components/data-table/DataTable";
import { features, marketFilterFn } from "@/components/data-table/features";

import { DASH, fmtPrice, fmtSignedUsd, fmtTime } from "../../lib/format";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";
import { newestFirst } from "./positionHistory";

interface Row {
  episode: PositionEpisode;
  symbol: string;
}

const helper = createColumnHelper<typeof features, Row>();

/** Что в этом эпизоде реконструировано, а не измерено. */
function caveats(e: PositionEpisode): string[] {
  const notes: string[] = [];
  if (e.openInferred) notes.push("Opening trade predates the indexed window");
  if (e.liquidationTouched) notes.push("A liquidation touched this episode");
  if (e.sizeDiverged) notes.push("Chain size disagreed with the rebuild");
  return notes;
}

const columns = helper.columns([
  helper.accessor((r) => r.symbol, {
    id: MARKET_COLUMN_ID,
    header: "Market",
    enableHiding: false,
    filterFn: (row, _id, value) =>
      marketFilterFn(row.original.episode.marketId.toString(), value),
    cell: (info) => {
      const notes = caveats(info.row.original.episode);
      return (
        <span className="inline-flex items-center gap-1 font-semibold">
          {info.getValue()}
          {notes.length > 0 && (
            <TriangleAlert
              size={12}
              className="text-muted"
              aria-label={notes.join("; ")}
            />
          )}
        </span>
      );
    },
  }),
  helper.accessor((r) => r.episode.direction, {
    id: "direction",
    header: "Direction",
    cell: (info) => (
      <span className={info.getValue() === "long" ? "text-long" : "text-short"}>
        {info.getValue() === "long" ? "Long" : "Short"}
      </span>
    ),
  }),
  helper.accessor((r) => r.episode.openedAt, {
    id: "opened",
    header: "Opened",
    // Секунды, а не миллисекунды: гейтвей отдаёт unix-seconds.
    cell: (info) => (
      <span className="text-muted">{fmtTime(info.getValue() * 1000)}</span>
    ),
  }),
  helper.accessor((r) => r.episode.closedAt, {
    id: "closed",
    header: "Closed",
    cell: (info) => (
      <span className="text-muted">{fmtTime(info.getValue() * 1000)}</span>
    ),
  }),
  helper.accessor((r) => Number(r.episode.avgEntryPrice), {
    id: "entry",
    header: "Avg Entry",
    cell: (info) => fmtPrice(info.row.original.episode.avgEntryPrice),
  }),
  helper.accessor((r) => Number(r.episode.avgClosePrice ?? 0n), {
    id: "close",
    header: "Avg Close",
    cell: (info) => {
      const px = info.row.original.episode.avgClosePrice;
      return px === null ? DASH : fmtPrice(px);
    },
  }),
  helper.accessor((r) => Number(r.episode.maxSize), {
    id: "size",
    header: "Max Size",
    cell: (info) => formatQty(info.row.original.episode.maxSize),
  }),
  helper.accessor((r) => Number(r.episode.realizedPnl ?? 0n), {
    id: "rpnl",
    header: "Realized P&L",
    cell: (info) => {
      const pnl = info.row.original.episode.realizedPnl;
      if (pnl === null) return <span className="text-muted">{DASH}</span>;
      return (
        <span className={pnl < 0n ? "text-short" : "text-long"}>
          {fmtSignedUsd(pnl)}
        </span>
      );
    },
  }),
  helper.accessor((r) => Number(r.episode.feesUsd ?? 0n), {
    id: "fees",
    header: "Fees",
    cell: (info) => {
      const fees = info.row.original.episode.feesUsd;
      return fees === null ? DASH : formatUsd(fees);
    },
  }),
  helper.accessor((r) => r.episode.closedBy, {
    id: "closedBy",
    header: "Close Type",
    // Различает `trade` и `liquidation` — и только их. Market против Limit
    // гейтвей в эпизоде не хранит.
    cell: (info) => (
      <span
        className={
          info.getValue() === "liquidation" ? "text-short" : "text-muted"
        }
      >
        {info.getValue() === "liquidation" ? "Liquidation" : "Trade"}
      </span>
    ),
  }),
]);

export function PositionHistoryTable() {
  const { markets } = useSelectedMarket();
  const accountId = useAccountId();
  const { data, isLoading } = usePositionHistoryQuery(accountId);

  const rows = useMemo<Row[]>(
    () =>
      newestFirst(data?.episodes ?? []).map((episode) => ({
        episode,
        symbol: episode.symbol ?? marketSymbol(markets, episode.marketId),
      })),
    [data, markets],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      testid="position-history-table"
      rowId={(r) => `${r.episode.marketId}-${r.episode.openedAt}`}
      loading={isLoading}
      // `available: false` — «индексатор не держит событий этого счёта вовсе»,
      // а пустой `episodes` при `available: true` — «счёт торговал и ничего не
      // закрыл». Схлопнуть их значило бы сказать «истории нет» там, где сказать
      // нечего.
      notice={
        data && !data.available
          ? {
              testid: "position-history-unavailable",
              text: "History source is silent for this account.",
            }
          : null
      }
      emptyText="No closed positions."
    />
  );
}
