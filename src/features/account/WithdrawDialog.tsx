import {
  useAccountDebtQuery,
  useAccountId,
  useAvailableMarginQuery,
  useCollateralAmountQuery,
  useDepositableBalance,
  useWithdrawMutation,
} from "@liq/react";
import { formatUsd } from "@liq/core";

import {
  CollateralAmountDialog,
  useCollateralSymbol,
} from "./CollateralAmountDialog";
import { repayShortfall } from "./repayShortfall";

export function WithdrawDialog({
  open,
  onClose,
  initialSymbol,
}: {
  open: boolean;
  onClose: () => void;
  /** Токен, с которого открывается диалог (строка Assets); иначе — первый контура. */
  initialSymbol?: string;
}) {
  const accountId = useAccountId();
  const { data: margins } = useAvailableMarginQuery();
  // Те же токены, что принимает депозит; вывод отдаёт на кошелёк сам токен,
  // а не синт (SDK разворачивает его в том же батче).
  const { symbols, symbol, setSymbol, collateral } =
    useCollateralSymbol(initialSymbol);
  // Сколько именно этого токена лежит на аккаунте: withdrawable — USD по всем
  // коллатералам, и с двумя синтами MAX подставил бы сумму, которой в этом
  // токене нет — контракт откатил бы без причины.
  const { data: held } = useCollateralAmountQuery(BigInt(collateral.marketId));

  // Synthetix blocks ALL collateral withdrawals while the account carries debt
  // (closed-at-loss); a plain withdraw would revert. Read it so we can offer an
  // atomic repay+withdraw instead. Best-effort: on error/loading the value is
  // `undefined`, which falls through to the normal withdraw path (so debt-free
  // or mocked accounts are unaffected). Та же запись кэша, что у панели Account
  // (`useAccountDebtQuery`): до SDK 0.56.0 здесь стоял свой `useQuery` с другим
  // ключом, и два экрана показывали разный долг.
  const { data: debt } = useAccountDebtQuery();
  const hasDebt = debt !== undefined && debt > 0n;

  // Долг гасится из USDC кошелька при любом выбранном токене вывода
  // (`RepayBuilder` SDK). Без проверки пустой кошелёк узнавал об этом
  // ревёртом симуляции (TRM-29).
  const { data: wallet } = useDepositableBalance("USDC");
  const shortfall = repayShortfall(debt, hasDebt ? wallet?.token : undefined);

  // Потолок вывода. Без долга — withdrawable (≤ available; ниже при открытых
  // позициях). С долгом протокол отвечает withdrawable = 0, а repay снимает
  // этот запрет в той же транзакции, поэтому потолком служит available; если
  // позиции его не отпустят, откажет сам контракт — ошибка ниже. И то и другое
  // режется остатком выбранного токена на аккаунте.
  const marginLimit = hasDebt ? margins?.available : margins?.withdrawable;
  const caps = [marginLimit, held].filter((x): x is bigint => x !== undefined);
  const limit = caps.length ? caps.reduce((a, b) => (a < b ? a : b)) : undefined;

  // Один план: снять синт с аккаунта и развернуть его в токен, а при долге —
  // погасить в голове того же плана; долг хук читает сам. Отправителя выбирает
  // провайдер — проп `relay` в LiqSetup (ADR-0063).
  const withdraw = useWithdrawMutation();

  return (
    <CollateralAmountDialog
      open={open}
      onClose={onClose}
      testIdPrefix="withdraw"
      title={`Withdraw ${symbol}`}
      symbols={symbols}
      symbol={symbol}
      onSymbolChange={setSymbol}
      decimals={collateral.decimals}
      limit={limit}
      limitLabel="Available to withdraw"
      exceededText="Exceeds available to withdraw."
      notice={
        hasDebt && (
          <div
            className="mb-3 rounded border border-short/40 bg-short/10 p-2 text-[11px] text-short"
            data-testid="withdraw-debt-notice"
          >
            ⚠ Account debt: {formatUsd(debt ?? 0n)}. Withdrawals are blocked
            until repaid — this repays your debt (from wallet funds) and
            withdraws in one transaction.
          </div>
        )
      }
      blockedReason={
        shortfall === null ? null : (
          <span data-testid="withdraw-wallet-short">
            Not enough USDC in your wallet to repay the {formatUsd(debt ?? 0n)}{" "}
            debt (wallet: {formatUsd(wallet?.token ?? 0n)}). Top up the wallet
            first.
          </span>
        )
      }
      submitLabel={hasDebt ? "Repay & Withdraw" : "Withdraw"}
      pendingLabel={hasDebt ? "Repaying…" : "Withdrawing…"}
      pending={withdraw.isPending}
      error={withdraw.error}
      disabled={accountId === undefined}
      onSubmit={({ amountWad }, onSuccess) => {
        if (accountId === undefined) return;
        withdraw.mutate(
          { accountId, amountWad, collateral: symbol },
          { onSuccess, onError: () => {} },
        );
      }}
    />
  );
}
