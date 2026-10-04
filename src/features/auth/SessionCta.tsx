import { humanizeError } from "@liq/core";
import {
  useAccountId,
  useCreateAccountMutation,
  useGatewayAuthMutation,
} from "@liq/react";
import { useEffect } from "react";
import { useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";

/**
 * Шаг онбординга на месте кнопок Buy / Sell: создать аккаунт, затем войти в шлюз.
 *
 * @remarks Живёт в подвале тикета, а не полноэкранным гейтом: новый пользователь
 * сразу видит терминал — стакан, чарт, Faucet в шапке, — а не пустой экран с
 * одной кнопкой. Стадии `disconnected` / `wrong-chain` / `loading` остаются за
 * `SessionGate`: без кошелька на верной сети показывать нечего.
 */
export function SessionCta({
  stage,
}: {
  stage: "no-account" | "needs-signin";
}) {
  const accountId = useAccountId();
  // Отправителя выбирает провайдер — проп `relay` в LiqSetup (ADR-0063).
  const createAccount = useCreateAccountMutation();
  const auth = useGatewayAuthMutation();

  // После перехода wrong-chain → MegaETH запрос walletClient у wagmi может
  // держать закешированный ConnectorChainMismatchError (staleTime: Infinity —
  // сам не перечитается). Сюда компонент попадает только на верной сети,
  // поэтому ошибка в запросе всегда устаревшая — перечитываем.
  const {
    data: walletClient,
    isError: walletClientErrored,
    refetch: refetchWalletClient,
  } = useWalletClient();
  useEffect(() => {
    if (walletClientErrored) void refetchWalletClient();
  }, [walletClientErrored, refetchWalletClient]);

  if (stage === "no-account") {
    return (
      <div className="flex flex-col gap-1.5" data-testid="session-no-account">
        <Button
          className="w-full"
          disabled={createAccount.isPending}
          onClick={() => createAccount.mutate(undefined)}
          data-testid="create-account-button"
        >
          {createAccount.isPending ? "Creating…" : "Create Account"}
        </Button>
        <ErrorLine error={createAccount.error} testid="create-account-error" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="session-needs-signin">
      <Button
        className="w-full"
        disabled={auth.isPending || accountId === undefined || !walletClient}
        onClick={() => accountId !== undefined && auth.mutate({ accountId })}
        data-testid="signin-button"
      >
        {auth.isPending ? "Signing…" : "Sign In"}
      </Button>
      <ErrorLine error={auth.error} testid="signin-error" />
    </div>
  );
}

/** Surfaces a mutation error inline, worded by `humanizeError`, so a failed CTA isn't a silent dead-end. */
export function ErrorLine({
  error,
  testid,
  formatMessage,
}: {
  error: Error | null;
  testid: string;
  /** Переопределяет {@link humanizeError} — например, чтобы назвать конкретную причину иначе. */
  formatMessage?: (error: Error) => string;
}) {
  if (!error) return null;
  return (
    <p className="text-[10px] text-short" role="alert" data-testid={testid}>
      {formatMessage ? formatMessage(error) : humanizeError(error)}
    </p>
  );
}
