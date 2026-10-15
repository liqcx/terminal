import { useSessionStage } from "@liq/react";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";

import { megaethTestnet } from "../../config/chain";
import { turnkeyLoginEnabled } from "../../config/env";
import { Button } from "@/components/ui/button";
import { bootGateLoading } from "./bootGate";
import { ErrorLine } from "./SessionCta";
import { SignInPanel } from "./SignInPanel";
import { useTurnkeyIdentity } from "./TurnkeyIdentityProvider";

/**
 * Показывает терминал, как только кошелёк подключён к верной сети и список
 * аккаунтов прочитан. Создание аккаунта и вход в шлюз — не гейт, а шаг в
 * подвале тикета (`SessionCta`): стакан, чарт и Faucet видны и до них.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  // Ветка стоит на константе времени сборки, а не на условии: `useTurnkeyIdentity()`
  // внутри `TurnkeyBootGate` бросает вне своего провайдера, и правило хуков требует,
  // чтобы выбор компонента, который его зовёт, не менялся за время монтирования
  // (тот же приём в `SignInPanel`, `ConnectButton`).
  const inner = <SessionGateInner>{children}</SessionGateInner>;
  return turnkeyLoginEnabled ? <TurnkeyBootGate>{inner}</TurnkeyBootGate> : inner;
}

/**
 * Перехватывает гейт, пока сессия Turnkey не восстановлена или восстановленная
 * личность ещё не получила встроенный кошелёк.
 *
 * @remarks
 * Первое окно — кит читает сохранённую сессию (`get_user`, `list_wallets`):
 * `authState` в это время уже `Unauthenticated`, и `SessionGateInner` рисовал
 * «Continue with email» поверх живой сессии — на 3G по 4–5 секунд (TRM-18).
 *
 * Второе — штатное восстановление wagmi заканчивается мгновенно: `isAuthorized()`
 * коннектора Turnkey зовёт `getProvider()` по пустому в этот тик реестру
 * провайдеров, а лестнице ещё только предстоит круг к auth-proxy и
 * `resolve-signer`.
 */
function TurnkeyBootGate({ children }: { children: ReactNode }) {
  const { subOrgId, embedded, restoring } = useTurnkeyIdentity();
  if (bootGateLoading({ restoring, subOrgId, embedded: embedded.kind })) {
    return (
      <Centered testid="session-loading">
        <p className="text-muted">Loading account…</p>
      </Centered>
    );
  }
  return <>{children}</>;
}

function SessionGateInner({ children }: { children: ReactNode }) {
  const account = useAccount();
  const switchChain = useSwitchChain();

  const stage = useSessionStage();

  // Пока wagmi восстанавливает единственный коннектор (`reconnectOnMount`),
  // `useSessionStage()` читает его как `disconnected`, и без этой ветки гейт
  // показывал бы экран входа кадром на каждой перезагрузке.
  if (account.isReconnecting || account.isConnecting) {
    return (
      <Centered testid="session-loading">
        <p className="text-muted">Loading account…</p>
      </Centered>
    );
  }

  if (stage === "disconnected") {
    return (
      <Centered testid="session-disconnected">
        <SignInPanel />
      </Centered>
    );
  }
  if (stage === "wrong-chain") {
    return (
      <Centered testid="session-wrong-chain">
        <p className="text-muted">
          Wrong network. Switch your wallet to MegaETH (chainId {megaethTestnet.id}).
        </p>
        <Button
          disabled={switchChain.isPending}
          onClick={() => switchChain.switchChain({ chainId: megaethTestnet.id })}
          data-testid="switch-chain-button"
        >
          {switchChain.isPending ? "Switching…" : "Switch to MegaETH"}
        </Button>
        <ErrorLine error={switchChain.error} testid="switch-chain-error" />
      </Centered>
    );
  }
  if (stage === "loading") {
    return (
      <Centered testid="session-loading">
        <p className="text-muted">Loading account…</p>
      </Centered>
    );
  }
  // no-account / needs-signin / ready: терминал на экране, следующий шаг
  // онбординга рисует тикет на месте Buy / Sell (`SessionCta`).
  return <>{children}</>;
}

function Centered({
  children,
  testid,
}: {
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3"
      data-testid={testid}
    >
      {children}
    </div>
  );
}
