import { abs, Side } from "@liq/sdk";
import { formatQty, formatUsd, humanizeError } from "@liq/core";
import { createColumnHelper } from "@tanstack/react-table";
import { Pencil, X } from "lucide-react";
import { useState } from "react";

import { DataTable, MARKET_COLUMN_ID } from "@/components/data-table/DataTable";
import { features, marketFilterFn } from "@/components/data-table/features";

import {
  DASH,
  fmtLeverage,
  fmtPrice,
  fmtSignedPct,
  fmtSignedUsd,
} from "../../lib/format";
import { ClosePositionsDialog } from "./ClosePositionsDialog";
import { TpSlDialog } from "./TpSlDialog";
import { type PositionRow, usePositionRows } from "./usePositionRows";

const helper = createColumnHelper<typeof features, PositionRow>();

/**
 * Действия таблицы едут через `table.options.meta`, а не полем строки: колонки
 * объявлены на уровне модуля и до состояния компонента не дотягиваются, а
 * `Close All` живёт в шапке, где строки нет вовсе.
 */
interface PositionActions {
  /** Спросить подтверждение на закрытие перечисленных позиций. */
  requestClose: (rows: readonly PositionRow[]) => void;
  /** Открыть правку скобок одной позиции. */
  requestEdit: (row: PositionRow) => void;
  /** Идёт ли проход закрытия — обе кнопки на это время выключены. */
  closing: boolean;
}

const columns = helper.columns([
  helper.accessor((r) => r.symbol, {
    id: MARKET_COLUMN_ID,
    header: "Market",
    enableHiding: false,
    filterFn: (row, _id, value) =>
      marketFilterFn(row.original.position.marketId.toString(), value),
    cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
  }),
  helper.accessor((r) => (r.position.side === Side.BUY ? 1 : 0), {
    id: "side",
    header: "Side",
    cell: (info) => {
      const p = info.row.original.position;
      const long = p.side === Side.BUY;
      return (
        <span className="inline-flex items-center gap-1">
          <span
            className={`rounded-sm px-1 text-[11px] ${long ? "bg-long-soft text-long" : "bg-short-soft text-short"}`}
          >
            {long ? "Long" : "Short"}
          </span>
          <span className="rounded-sm bg-surface-2 px-1 text-[11px] text-muted">
            {fmtLeverage(p.leverage)}
          </span>
        </span>
      );
    },
  }),
  helper.accessor((r) => Number(r.position.notional), {
    id: "value",
    header: "Value / Size",
    cell: (info) => {
      const r = info.row.original;
      return (
        <span className="flex flex-col leading-tight">
          <span>{formatUsd(r.position.notional)}</span>
          <span className="text-[11px] text-muted">
            ≈ {formatQty(abs(r.position.size))}
          </span>
        </span>
      );
    },
  }),
  helper.accessor((r) => Number(r.position.entryPrice), {
    id: "entry",
    header: "Entry Price",
    cell: (info) => fmtPrice(info.row.original.position.entryPrice),
  }),
  helper.accessor((r) => Number(r.markPrice ?? 0n), {
    id: "mark",
    header: "Mark Price",
    cell: (info) => {
      const mark = info.row.original.markPrice;
      return mark === undefined ? DASH : fmtPrice(mark);
    },
  }),
  helper.accessor((r) => Number(r.position.liquidationPrice), {
    id: "liq",
    header: "Liq. Price",
    // ZERO_PRICE — «показывать нечего» (неизвестный марк, плоская позиция,
    // уровень ниже нуля), а не цена ноль.
    cell: (info) => {
      const liq = info.row.original.position.liquidationPrice;
      return liq === 0n ? DASH : fmtPrice(liq);
    },
  }),
  helper.accessor((r) => Number(r.position.initialMarginUsd ?? 0n), {
    id: "margin",
    header: "Margin",
    cell: (info) => {
      const m = info.row.original.position.initialMarginUsd;
      return m === undefined ? DASH : formatUsd(m);
    },
  }),
  helper.accessor((r) => Number(r.position.accruedFunding ?? 0n), {
    id: "funding",
    header: "Funding",
    // `undefined` — «фандинг не известен». Ноль читался бы как «платежей не было».
    cell: (info) => {
      const f = info.row.original.position.accruedFunding;
      return f === undefined ? DASH : fmtSignedUsd(f);
    },
  }),
  helper.accessor((r) => Number(r.position.unrealizedPnl), {
    id: "upnl",
    header: "Unrealized P&L",
    cell: (info) => {
      const p = info.row.original.position;
      const tone = p.unrealizedPnl < 0n ? "text-short" : "text-long";
      return (
        <span className={`flex flex-col leading-tight ${tone}`}>
          <span>{fmtSignedUsd(p.unrealizedPnl)}</span>
          <span className="text-[11px]">{fmtSignedPct(p.pnlRatio)}</span>
        </span>
      );
    },
  }),
  helper.display({
    id: "rpnl",
    header: "Realized P&L",
    // У открытой позиции реализованного PnL нет ни в одном чтении: он появляется
    // строкой леджера при расчёте и эпизодом в истории позиций. Ноль здесь
    // означал бы «сделок не было», что для позиции с историей ложь.
    cell: () => <span className="text-muted">{DASH}</span>,
  }),
  helper.display({
    id: "tpsl",
    header: "TP / SL",
    cell: (info) => (
      <TpSlCell
        row={info.row.original}
        actions={info.table.options.meta as PositionActions}
      />
    ),
  }),
  helper.display({
    id: "actions",
    header: (info) => (
      <CloseAllHeader
        rows={info.table.options.data}
        actions={info.table.options.meta as PositionActions}
      />
    ),
    enableHiding: false,
    cell: (info) => (
      <RowActions
        row={info.row.original}
        actions={info.table.options.meta as PositionActions}
      />
    ),
  }),
]);

/** Цены скобок и карандаш рядом — по макету. */
function TpSlCell({
  row,
  actions,
}: {
  row: PositionRow;
  actions: PositionActions;
}) {
  const { takeProfit, stopLoss } = row.brackets;

  return (
    <span className="flex items-center gap-2">
      <span className="flex flex-col leading-tight text-[11px]">
        <span className="text-long">
          {takeProfit === null ? DASH : fmtPrice(takeProfit.triggerPrice)}
        </span>
        <span className="text-short">
          {stopLoss === null ? DASH : fmtPrice(stopLoss.triggerPrice)}
        </span>
      </span>
      <button
        type="button"
        className="text-muted hover:text-text"
        title="Edit TP / SL"
        onClick={() => actions.requestEdit(row)}
        data-testid={`edit-tpsl-${row.position.marketId}`}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Красный `Close All` в шапке последней колонки — по макету. */
function CloseAllHeader({
  rows,
  actions: { requestClose, closing },
}: {
  rows: readonly PositionRow[];
  actions: PositionActions;
}) {
  return (
    <button
      type="button"
      className="text-[11px] font-semibold text-short disabled:opacity-40"
      disabled={closing || rows.length === 0}
      onClick={() => requestClose(rows)}
      data-testid="close-all-button"
    >
      Close All
    </button>
  );
}

function RowActions({
  row,
  actions: { requestClose, closing },
}: {
  row: PositionRow;
  actions: PositionActions;
}) {
  return (
    <span className="flex items-center justify-end gap-2">
      <button
        type="button"
        className="text-short disabled:opacity-40"
        disabled={closing}
        title="Close position at market"
        onClick={() => requestClose([row])}
        data-testid={`close-position-${row.position.marketId}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export function PositionsTable() {
  const { rows, isLoading, isError, close, isClosing } = usePositionRows();
  const [target, setTarget] = useState<readonly PositionRow[]>(EMPTY_TARGET);
  const [editing, setEditing] = useState<PositionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Строка пересобирается на каждом опросе позиций, поэтому открытая правка
  // держится за рынок и берёт свежую строку — иначе скобки в диалоге застыли
  // бы на том, чем они были в момент клика.
  const editingRow =
    editing === null
      ? null
      : (rows.find((r) => r.position.marketId === editing.position.marketId) ??
        editing);

  async function confirmClose() {
    setError(null);
    try {
      const { failed } = await close(target);
      // Отказы не исключение: `useClosePositions` считает их и продолжает
      // проход. Диалог остаётся открытым только когда сказать есть что.
      if (failed > 0) {
        setError(`${failed} position${failed > 1 ? "s" : ""} could not be closed.`);
        return;
      }
      setTarget(EMPTY_TARGET);
    } catch (e) {
      setError(humanizeError(e));
    }
  }

  const actions: PositionActions = {
    requestClose: (next) => {
      setError(null);
      setTarget(next);
    },
    requestEdit: setEditing,
    closing: isClosing,
  };

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        meta={actions}
        testid="positions-table"
        rowId={(r) => r.position.marketId.toString()}
        loading={isLoading}
        // Пустой ответ и провалившееся чтение — разные вещи: `useEnrichedPositions`
        // роняет запрос, когда ERC-7412 отревертил чтение по протухшему оракулу,
        // и «позиций нет» на этом месте было бы прямой ложью.
        notice={
          isError
            ? {
                testid: "positions-error",
                text: "Price feed is stale — positions unavailable.",
              }
            : null
        }
        emptyText="No open positions."
      />
      {editingRow && (
        <TpSlDialog
          key={editingRow.position.marketId.toString()}
          row={editingRow}
          onClose={() => setEditing(null)}
        />
      )}
      <ClosePositionsDialog
        rows={target}
        pending={isClosing}
        error={error}
        onClose={() => setTarget(EMPTY_TARGET)}
        onConfirm={() => void confirmClose()}
      />
    </>
  );
}

const EMPTY_TARGET: readonly PositionRow[] = [];
