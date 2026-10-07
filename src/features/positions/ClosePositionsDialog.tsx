import { abs, Side } from "@liq/sdk";
import { formatQty } from "@liq/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { DASH, fmtPrice } from "../../lib/format";
import type { PositionRow } from "./usePositionRows";

/**
 * Подтверждение закрытия — одной позиции или всех.
 *
 * @remarks Закрытие подаёт рыночный ордер: отменить его нельзя, и промах мышью
 * по ✕ стоил бы позиции. Диалог перечисляет закрываемые позиции, скобки,
 * которые снимет расчёт закрытия (терминал отмену скобок не шлёт), и обещание
 * не трогать отдыхающие лимитки, раз кнопка про них не говорила.
 */
export function ClosePositionsDialog({
  rows,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  /** Пустой список = диалог закрыт. */
  rows: readonly PositionRow[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const legs = rows.reduce((n, r) => n + r.legs.length, 0);
  const all = rows.length > 1;

  return (
    <Dialog
      open={rows.length > 0}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="close-positions-dialog"
        overlayTestId="dialog-overlay"
        className="w-[360px]"
      >
        <DialogHeader className="mb-3">
          <DialogTitle className="text-sm font-semibold">
            {all ? `Close ${rows.length} positions` : "Close position"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1 text-[11px]">
          {rows.map((r) => {
            const long = r.position.side === Side.BUY;
            return (
              <div
                key={r.position.marketId.toString()}
                className="flex items-center justify-between gap-2"
                data-testid={`close-summary-${r.position.marketId}`}
              >
                <span className="font-semibold">{r.symbol}</span>
                <span className={long ? "text-long" : "text-short"}>
                  {long ? "Long" : "Short"}
                </span>
                <span className="text-muted">
                  {formatQty(abs(r.position.size))}
                </span>
                <span className="text-muted">
                  {r.markPrice === undefined ? DASH : fmtPrice(r.markPrice)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Closes at market with a 0.5% slippage bound.
          {legs > 0
            ? ` Reduce-only ${legs > 1 ? "orders" : "order"} of ${all ? "these positions" : "this position"} (${legs}) ${legs > 1 ? "are" : "is"} cancelled once the close settles.`
            : ""}{" "}
          Other resting limit orders are not touched.
        </p>

        {error && (
          <p
            className="mt-2 text-[11px] text-short"
            data-testid="close-positions-error"
          >
            {error}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            data-testid="close-positions-cancel"
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-short text-white hover:brightness-110"
            disabled={pending}
            onClick={onConfirm}
            data-testid="close-positions-confirm"
          >
            {pending ? "Closing…" : all ? "Close all" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
