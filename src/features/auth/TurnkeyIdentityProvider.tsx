import {
  AUTHED_QUERY_PREFIXES,
  AuthState,
  useGatewayStore,
  useTurnkey,
} from "@liq/react";
import {
  createEmbeddedProvider,
  createEmbeddedWallet,
  setTurnkeyProvider,
  TURNKEY_CONNECTOR_ID,
} from "@liq/turnkey";
import { tokenAddress } from "@liq/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { LocalAccount } from "viem";
import { useAccount, useConnect, useReconnect } from "wagmi";

import { megaethTestnet } from "../../config/chain";
import { env } from "../../config/env";
import { turnkeyRestoring } from "./bootGate";
import { identityResetReason } from "./identityReset";

/** Куда дошло разрешение встроенного кошелька — для тех, кто это показывает. */
type EmbeddedWalletState =
  | { kind: "idle" }
  | { kind: "resolving" }
  | { kind: "ready"; address: `0x${string}` }
  | { kind: "failed"; error: unknown };

type TurnkeyIdentityValue = {
  /** subOrgId текущей личности; `null`, пока не вошли. */
  subOrgId: string | null;
  embedded: EmbeddedWalletState;
  /**
   * Кит Turnkey ещё восстанавливает сохранённую сессию: `subOrgId === null`
   * в это окно не значит «не вошли» (см. `turnkeyRestoring`).
   */
  restoring: boolean;
  /** Переоткрыть упавшее разрешение — по клику, не автоматически. */
  retryResolve: () => void;
};

const TurnkeyIdentityContext = createContext<TurnkeyIdentityValue | null>(null);

/** Читает личность Turnkey. Бросает вне `<TurnkeyIdentityProvider>`. */
export function useTurnkeyIdentity(): TurnkeyIdentityValue {
  const value = useContext(TurnkeyIdentityContext);
  if (!value) {
    throw new Error(
      "useTurnkeyIdentity: только внутри <TurnkeyIdentityProvider>",
    );
  }
  return value;
}

/**
 * Личность за дверью Turnkey: подписант → wagmi.
 *
 * @remarks
 * Каждый шаг — одно обращение на личность, и все гарантии, которых они
 * требуют, даёт ключ кэша react-query, а не собственный механизм:
 *
 * - «не более одного разрешения кошелька на суб-организацию» — это дедупликация
 *   по `queryKey` плюс `staleTime: Infinity`. Гарантия несущая:
 *   `createEmbeddedWallet` — это fetch-or-create, второе одновременное
 *   разрешение суб-организации без кошелька создаёт ВТОРОЙ кошелёк, а
 *   `SnxAccount.owner` пишется один раз и не переписывается — аккаунт
 *   проигравшего недостижим навсегда.
 * - «приземление отменённой личности не отдаётся новой» — это смена ключа:
 *   ответ старого запроса остаётся в кэше под старым `subOrgId` и наружу не
 *   выходит вовсе.
 * - «одна попытка, дальше по клику» — `retry: false` плюс `refetch()`.
 *
 * Шаг `connect` библиотекой не покрывается и остался явной защёлкой: его надо
 * ВЗВОДИТЬ после неудачи (иначе повтор гоняется бесконечно — в `liqu` это
 * намеряли как ~200 попыток за секунды при вкладке на 100% CPU) и СНИМАТЬ
 * после разрыва живого соединения. `useConnect().status` для этого не годится:
 * после `success` и последующего disconnect он остаётся `success`.
 *
 * Монтируется внутри `<TurnkeyProviderWrapper>` (нужен `useTurnkey`) и внутри
 * `<LiqProvider>` / `<WagmiProvider>` (нужны ступень сессии и `useConnect`).
 */
export function TurnkeyIdentityProvider({ children }: { children: ReactNode }) {
  const { authState, session, clientState } = useTurnkey();
  const wagmiAccount = useAccount();
  const token = useGatewayStore((s) => s.token);
  const queryClient = useQueryClient();
  const { connect, connectors } = useConnect();
  const { reconnect } = useReconnect();

  const subOrgId =
    authState === AuthState.Authenticated
      ? (session?.organizationId ?? null)
      : null;

  // Шаг 1. Подписант суб-организации.
  const embedded = useQuery({
    queryKey: ["turnkey-embedded-wallet", subOrgId],
    queryFn: () =>
      createEmbeddedWallet({
        orgId: env.turnkey.orgId,
        authProxyUrl: env.turnkey.authProxyUrl,
        authProxyConfigId: env.turnkey.authProxyConfigId,
      }),
    enabled: subOrgId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  // Без страховки на `subOrgId === null`: ключ кэша тогда другой, и `data` по
  // нему пуста сама — отдельная проверка защищала бы от того, чего не бывает.
  const account: LocalAccount | undefined = embedded.data?.account;
  const address = embedded.data?.address;

  const wagmiAddress = wagmiAccount.address?.toLowerCase() ?? null;
  const tokenAddr = tokenAddress(token);

  // Шаг 2. Гигиена сессии: смена личности, выход и чужой адрес в токене
  // одинаково роняют токен, реестр провайдеров и приватные кэши.
  // `removeQueries`, а не инвалидация: перезапрос со старым токеном
  // воспроизвёл бы ровно то, что убирали.
  const prevSubOrgId = useRef<string | null>(null);
  const connectTried = useRef(false);
  useEffect(() => {
    const reason = identityResetReason({
      prev: prevSubOrgId.current,
      next: subOrgId,
      tokenAddress: tokenAddr,
      wagmiAddress,
    });
    prevSubOrgId.current = subOrgId;
    if (!reason) return;
    connectTried.current = false;
    useGatewayStore.getState().clearToken();
    setTurnkeyProvider(undefined);
    for (const prefix of AUTHED_QUERY_PREFIXES) {
      queryClient.removeQueries({ queryKey: prefix });
    }
  }, [subOrgId, tokenAddr, wagmiAddress, queryClient]);

  // Разрешённый подписант становится EIP-1193-провайдером и уходит в реестр:
  // ключ в TEE не расширение браузера, в списке `walletProviders` у Turnkey его
  // не бывает, поэтому провайдер синтезируется.
  useEffect(() => {
    if (authState !== AuthState.Authenticated || !account) {
      setTurnkeyProvider(undefined);
      return;
    }
    setTurnkeyProvider(
      createEmbeddedProvider({
        account,
        chain: megaethTestnet,
        rpcUrl: megaethTestnet.rpcUrls.default.http[0],
      }),
    );
  }, [authState, account]);

  // Шаг 3. Отдаём подписанта в wagmi. Провайдер смонтирован только за дверью
  // Turnkey (`LiqSetup`), поэтому пересадить под TEE-кошелёк того, кто вошёл
  // иначе, отсюда нельзя.
  useEffect(() => {
    // Живое подключение снимает защёлку: соединение, которое получилось и потом
    // отвалилось, заслуживает новой попытки, а неудавшееся — нет. Неудачу wagmi
    // не сообщает никак (`connect` — это `mutate()`), поэтому «не вышло»
    // выражено как «защёлка взведена, а isConnected ложно».
    if (wagmiAccount.isConnected) {
      connectTried.current = false;
      return;
    }
    if (!account) return;
    if (wagmiAccount.isConnecting || wagmiAccount.isReconnecting) return;
    if (connectTried.current) return;
    const connector = connectors.find((c) => c.id === TURNKEY_CONNECTOR_ID);
    if (!connector) return;
    connectTried.current = true;
    // Оба вызова уходят не дожидаясь друг друга — это гонка, а не
    // последовательность. `reconnect()` перенимает соединение, которое провайдер
    // уже держит; `connect()` заводит новое и бросает
    // ConnectorAlreadyConnectedError, когда живое уже есть. Бросок безвреден:
    // `connect` — это `mutate()`, а не `mutateAsync()`, отказ проглатывается
    // внутри react-query. Вдвоём они покрывают и первое подключение, и всё ещё
    // живой провайдер, ничего не дожидаясь.
    reconnect({ connectors: [connector] });
    connect({ connector });
  }, [
    account,
    wagmiAccount.isConnected,
    wagmiAccount.isConnecting,
    wagmiAccount.isReconnecting,
    connectors,
    connect,
    reconnect,
  ]);

  const value = useMemo<TurnkeyIdentityValue>(() => {
    const embeddedView: EmbeddedWalletState =
      subOrgId === null
        ? { kind: "idle" }
        : embedded.isError
          ? { kind: "failed", error: embedded.error }
          : address
            ? { kind: "ready", address }
            : { kind: "resolving" };
    return {
      subOrgId,
      embedded: embeddedView,
      restoring: turnkeyRestoring(clientState),
      retryResolve: () => void embedded.refetch(),
    };
  }, [subOrgId, address, embedded, clientState]);

  return (
    <TurnkeyIdentityContext.Provider value={value}>
      {children}
    </TurnkeyIdentityContext.Provider>
  );
}
