import {
  bracketsPlanFor,
  describeBracketRejection,
  describeBracketWarning,
  Price,
} from "@liq/sdk";
import { useAccountId, useApplyBracketsMutation } from "@liq/react";
import { humanizeError, wadToFixed } from "@liq/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { parseOrZero } from "../../lib/format";
import { DecimalInput } from "../../components/ui/DecimalInput";
import type { PositionRow } from "./usePositionRows";

/**
 * Правка скобок одной позиции.
 *
 * @remarks Поля предзаполнены текущими триггерами: диалог показывает состояние,
 * а не пустой бланк, — иначе «Save» с нетронутым полем снял бы обе скобки.
 * Начальное значение берётся при монтировании, а родитель монтирует диалог с
 * `key` по рынку: сброс полей через эффект переписывал бы уже набранное на
 * каждом опросе позиций.
 *
 * План правки, порядок «подача, потом отмена», связка ног и сбор отказов живут
 * в `useApplyBracketsMutation`: то же действие зовёт тикет для скобок входа, и
 * второй копии правила у терминала больше нет.
 *
 * Отказ проверки и отказ шлюза стоят разными строками: `tpsl-validation` —
 * «не отправили», `tpsl-error` — «отправили, и шлюз отказал». Смешав их, экран
 * сказал бы, что заявка ушла, хотя на провод ничего не уходило.
 */
export function TpSlDialog({
  row,
  onClose,
}: {
  row: PositionRow;
  onClose: () => void;
}) {
  const accountId = useAccountId();
  const applyBrackets = useApplyBracketsMutation(accountId);
  const [tp, setTp] = useState(() =>
    row.brackets.takeProfit
      ? wadToFixed(row.brackets.takeProfit.triggerPrice, 2)
      : "",
  );
  const [sl, setSl] = useState(() =>
    row.brackets.stopLoss
      ? wadToFixed(row.brackets.stopLoss.triggerPrice, 2)
      : "",
  );

  const tpPrice = Price(parseOrZero(Price.parse, tp));
  const slPrice = Price(parseOrZero(Price.parse, sl));
  // Марк строки живой: таблица обновляет его вместе с ценами, и план
  // пересчитывается — скобка, законная минуту назад, гаснет вместе с ценой.
  const plan = bracketsPlanFor({
    position: row.position,
    brackets: row.brackets,
    takeProfit: tpPrice,
    stopLoss: slPrice,
    markPrice: Price(row.markPrice ?? 0n),
    liquidationPrice: row.position.liquidationPrice,
  });
  const rejection = plan.rejected
    .map((r) => describeBracketRejection(r))
    .filter((t) => t !== undefined)
    .join(" · ");
  const warning = describeBracketWarning(plan.warn);

  // `mutate` (не `mutateAsync`): отказ показывается из `applyBrackets.error`
  // ниже, а диалог остаётся открытым — закрывать его поверх ошибки значило бы
  // прятать её.
  function save() {
    applyBrackets.mutate(
      {
        position: row.position,
        brackets: row.brackets,
        // Пустое поле — `0n`, то есть «снять».
        takeProfit: tpPrice,
        stopLoss: slPrice,
        // Марк строки: по нему же судит гейт Save ниже.
        markPrice: Price(row.markPrice ?? 0n),
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="tpsl-dialog"
        overlayTestId="dialog-overlay"
        className="w-[min(320px,calc(100vw-2rem))]"
      >
        <DialogHeader className="mb-3">
          <DialogTitle className="text-sm font-semibold">
            TP / SL — {row.symbol}
          </DialogTitle>
        </DialogHeader>

        <label className="mb-1 block text-[10px] uppercase text-muted">
          Take profit
        </label>
        <DecimalInput
          value={tp}
          onValueChange={setTp}
          maxDecimals={2}
          placeholder="0.00"
          data-testid="tpsl-tp-input"
        />

        <label className="mb-1 mt-3 block text-[10px] uppercase text-muted">
          Stop loss
        </label>
        <DecimalInput
          value={sl}
          onValueChange={setSl}
          maxDecimals={2}
          placeholder="0.00"
          data-testid="tpsl-sl-input"
        />

        <p className="mt-2 text-[11px] text-muted">
          Empty field removes the bracket. Orders are reduce-only.
        </p>

        {rejection !== "" && (
          <p
            className="mt-2 text-[11px] text-short"
            data-testid="tpsl-validation"
          >
            {rejection}
          </p>
        )}

        {warning && (
          <p
            className="mt-2 text-[11px] text-muted"
            data-testid="tpsl-warning"
          >
            {warning}
          </p>
        )}

        {applyBrackets.error && (
          <p className="mt-2 text-[11px] text-short" data-testid="tpsl-error">
            {humanizeError(applyBrackets.error)}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            data-testid="tpsl-cancel"
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={
              applyBrackets.isPending || accountId === undefined || plan.rejected.length > 0
            }
            onClick={save}
            data-testid="tpsl-save"
          >
            {applyBrackets.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
