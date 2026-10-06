import { Margin } from "@liq/sdk";
import {
  formatUsd,
  getChainConfig,
  getCollaterals,
  humanizeError,
  wadToFixed,
} from "@liq/core";
import { useNetworkId } from "@liq/react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseOrZero } from "../../lib/format";
import { DecimalInput } from "../../components/ui/DecimalInput";
import { CollateralTabs } from "./CollateralTabs";

/**
 * Выбранный токен коллатерала. Токены контура берутся из конфига SDK: на prod
 * один USDC, на staging ещё USDm. Начальное значение читается один раз:
 * вызывающий, которому нужен другой токен на повторном открытии, перемонтирует
 * диалог через `key`.
 */
export function useCollateralSymbol(initialSymbol?: string) {
  const networkId = useNetworkId();
  const collaterals = getCollaterals(getChainConfig(networkId));
  const symbols = Object.keys(collaterals);
  const [symbol, setSymbol] = useState(
    initialSymbol !== undefined && symbols.includes(initialSymbol)
      ? initialSymbol
      : symbols[0],
  );
  return { symbols, symbol, setSymbol, collateral: collaterals[symbol] };
}

/**
 * Тело диалога суммы — экранная часть депозита и вывода: выбор токена, поле
 * суммы с MAX, гейт «больше потолка», строка отказа, кнопки. Чем ограничена
 * сумма и какой мутацией отправляется — знает вызывающий (`DepositDialog` /
 * `WithdrawDialog`); диалог знает только само число.
 *
 * Отправка идёт через `mutate`, а не `mutateAsync`: отказ показывается из
 * `error`, а отклонённый промис в обработчике клика стал бы unhandled
 * rejection. По той же причине у обеих мутаций пустой `onError`.
 */
export function CollateralAmountDialog({
  open,
  onClose,
  testIdPrefix,
  title,
  symbols,
  symbol,
  onSymbolChange,
  decimals,
  limit,
  limitLabel,
  exceededText,
  notice,
  blockedReason,
  submitLabel,
  pendingLabel,
  pending,
  error,
  disabled = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** Префикс `data-testid` контура диалога: `deposit` | `withdraw`. */
  testIdPrefix: string;
  title: string;
  symbols: string[];
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  decimals: number;
  /** Потолок суммы; `undefined` — чтение недоступно: ни MAX, ни гейта. */
  limit?: bigint;
  limitLabel: string;
  exceededText: string;
  /** Предупреждение над строкой потолка (долг аккаунта у вывода). */
  notice?: ReactNode;
  /**
   * Почему отправить нельзя, хотя сумма годна (у вывода — не хватает USDC
   * кошелька на долг). Есть — кнопка гаснет, строка стоит под суммой.
   */
  blockedReason?: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: Error | null;
  /** Ещё не с чем отправлять — нет аккаунта. */
  disabled?: boolean;
  onSubmit: (
    input: { amount: string; amountWad: bigint },
    onSuccess: () => void,
  ) => void;
}) {
  const [amount, setAmount] = useState("");
  const amountWad = parseOrZero(Margin.parse, amount);
  const exceedsLimit = limit !== undefined && amountWad > limit;
  const blocked =
    disabled ||
    pending ||
    amountWad <= 0n ||
    exceedsLimit ||
    blockedReason != null;

  function submit() {
    if (blocked) return;
    onSubmit({ amount, amountWad }, () => {
      setAmount("");
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid={`${testIdPrefix}-dialog`}
        overlayTestId="dialog-overlay"
        className="w-[min(320px,calc(100vw-2rem))]"
      >
        <DialogHeader className="mb-3">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <CollateralTabs
          symbols={symbols}
          value={symbol}
          onChange={(next) => {
            onSymbolChange(next);
            setAmount("");
          }}
          testIdPrefix={testIdPrefix}
        />
        {notice}
        {limit !== undefined && (
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>{limitLabel}</span>
            <span className="text-text" data-testid={`${testIdPrefix}-balance`}>
              {formatUsd(limit)}
            </span>
          </div>
        )}
        <DecimalInput
          value={amount}
          onValueChange={setAmount}
          maxDecimals={decimals}
          invalid={exceedsLimit}
          placeholder="100"
          data-testid={`${testIdPrefix}-amount-input`}
          rightSlot={
            limit !== undefined && limit > 0n ? (
              <button
                type="button"
                onClick={() => setAmount(wadToFixed(limit, 2))}
                className="rounded-[var(--radius-sm)] bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-accent hover:brightness-110"
                data-testid={`${testIdPrefix}-max-button`}
              >
                MAX
              </button>
            ) : undefined
          }
        />
        {exceedsLimit && (
          <p
            className="mt-1 text-[10px] text-short"
            data-testid={`${testIdPrefix}-validation`}
          >
            {exceededText}
          </p>
        )}
        {blockedReason != null && (
          <p className="mt-2 text-[11px] text-short">{blockedReason}</p>
        )}
        {error && (
          <p
            className="mt-2 text-[11px] text-short"
            data-testid={`${testIdPrefix}-error`}
          >
            {humanizeError(error)}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            data-testid={`${testIdPrefix}-cancel-button`}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={blocked}
            onClick={submit}
            data-testid={`${testIdPrefix}-submit-button`}
          >
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
