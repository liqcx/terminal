// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Договор личности за дверью Turnkey — тот самый, что раньше описывал редьюсер
 * лестницы, а теперь держат ключи кэша react-query и одна защёлка.
 *
 * @remarks Проверяется не реализация, а обещания, ценой которых был написан
 * механизм: кошелёк суб-организации разрешается РОВНО ОДИН РАЗ (второе
 * разрешение создаёт второй кошелёк, а `SnxAccount.owner` не переписывается),
 * подписант отменённой личности не достаётся следующей, `connect` не гоняется
 * в цикле после неудачи и перевзводится после разрыва.
 */

const createEmbeddedWallet = vi.fn<(opts: unknown) => Promise<unknown>>();
const setTurnkeyProvider = vi.fn<(provider: unknown) => void>();
const createEmbeddedProvider =
  vi.fn<(opts: { account: unknown }) => unknown>();
const connect = vi.fn();
const reconnect = vi.fn();
const removeQueries = vi.fn();
const clearToken = vi.fn();

let turnkey = {
  authState: "authenticated",
  session: { organizationId: "sub-1" } as { organizationId: string } | undefined,
  clientState: "ready" as string | undefined,
};
let wagmi = {
  address: undefined as string | undefined,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
};
let gatewayToken: string | null = null;

vi.mock("@liq/react", () => ({
  AUTHED_QUERY_PREFIXES: [["positions"]],
  AuthState: { Authenticated: "authenticated" },
  useTurnkey: () => turnkey,
  useGatewayStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ token: gatewayToken }),
    { getState: () => ({ clearToken }) },
  ),
}));
vi.mock("@liq/turnkey", () => ({
  TURNKEY_CONNECTOR_ID: "turnkey",
  createEmbeddedWallet: (opts: unknown) => createEmbeddedWallet(opts),
  createEmbeddedProvider: (opts: { account: unknown }) =>
    createEmbeddedProvider(opts),
  setTurnkeyProvider: (provider: unknown) => setTurnkeyProvider(provider),
}));
vi.mock("@liq/core", () => ({
  tokenAddress: (t: string | null) => t,
}));
vi.mock("wagmi", () => ({
  useAccount: () => wagmi,
  useConnect: () => ({ connect, connectors: [{ id: "turnkey" }] }),
  useReconnect: () => ({ reconnect }),
}));
vi.mock("../../../config/chain", () => ({
  megaethTestnet: { id: 6343, rpcUrls: { default: { http: ["https://rpc.test"] } } },
}));
vi.mock("../../../config/env", () => ({
  env: {
    turnkey: { orgId: "org", authProxyUrl: "https://ap.test", authProxyConfigId: "cfg" },
  },
}));

const { TurnkeyIdentityProvider, useTurnkeyIdentity } = await import(
  "../TurnkeyIdentityProvider"
);

/**
 * Что провайдер отдал наружу на последнем кадре.
 *
 * @remarks Поле объекта, а не переменная модуля: правило `react-hooks/globals`
 * запрещает переприсваивать внешнюю переменную из тела компонента, и оно право —
 * запись в замыкание пережила бы размонтирование.
 */
const seen: { value: ReturnType<typeof useTurnkeyIdentity> | null } = {
  value: null,
};
function Probe(): null {
  const value = useTurnkeyIdentity();
  // Запись в эффекте, а не в теле: правило `react-hooks/globals` запрещает
  // трогать внешнее состояние во время рендера, и оно право — React волен
  // звать тело компонента, не коммитя его. `settle()` прокручивает эффекты,
  // поэтому зонд всё равно отражает последний ЗАКОММИЧЕННЫЙ кадр.
  useEffect(() => {
    seen.value = value;
  }, [value]);
  return null;
}

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

function render(): void {
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          TurnkeyIdentityProvider,
          null,
          createElement(Probe) as ReactNode,
        ),
      ),
    );
  });
}

/**
 * Даёт промисам queryFn приземлиться и React — доиграть вызванные ими рендеры.
 *
 * @remarks Тиков несколько, а не один: приземление запроса вызывает рендер,
 * рендер — эффект, эффект — ещё один запрос. С одним тиком тест ловил
 * промежуточный кадр и падал через раз.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  createEmbeddedProvider.mockReturnValue({ mock: "provider" });
  createEmbeddedWallet.mockImplementation(async () => ({
    address: "0xwallet",
    account: { signMessage: vi.fn(async () => "0xsig") },
  }));
  turnkey = { authState: "authenticated", session: { organizationId: "sub-1" }, clientState: "ready" };
  wagmi = { address: undefined, isConnected: false, isConnecting: false, isReconnecting: false };
  gatewayToken = null;
  seen.value = null;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.removeQueries = removeQueries;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("подписант суб-организации", () => {
  it("разрешается ровно один раз, сколько бы раз ни перерисовались", async () => {
    render();
    await settle();
    render();
    render();
    await settle();
    expect(createEmbeddedWallet).toHaveBeenCalledTimes(1);
  });

  it("не разрешается, пока личности нет", async () => {
    turnkey = { authState: "unauthenticated", session: null } as never;
    render();
    await settle();
    expect(createEmbeddedWallet).not.toHaveBeenCalled();
  });

  it("новая личность разрешается заново и не получает прежнего подписанта", async () => {
    render();
    await settle();
    expect(createEmbeddedProvider).toHaveBeenCalledTimes(1);

    createEmbeddedProvider.mockReturnValue({ mock: "provider" });
  createEmbeddedWallet.mockImplementation(async () => ({
      address: "0xsecond",
      account: { signMessage: vi.fn(async () => "0xsig2") },
    }));
    turnkey = { authState: "authenticated", session: { organizationId: "sub-2" }, clientState: "ready" };
    render();
    await settle();

    expect(createEmbeddedWallet).toHaveBeenCalledTimes(2);
    const last = createEmbeddedProvider.mock.calls.at(-1)?.[0];
    const newest = (await createEmbeddedWallet.mock.results.at(-1)?.value) as {
      account: unknown;
    };
    expect(last?.account).toBe(newest.account);
  });

  it("падение разрешения не уходит в цикл повторов и видно снаружи", async () => {
    createEmbeddedWallet.mockRejectedValue(new Error("enclave down"));
    render();
    await settle();
    await settle();
    expect(createEmbeddedWallet).toHaveBeenCalledTimes(1);
    // Отказ обязан ДОЕХАТЬ до экрана: пока он читается как «ещё разрешаем»,
    // гейт держит пользователя на «Loading account…» навсегда.
    expect(seen.value?.embedded.kind).toBe("failed");
  });

  it("упавшее разрешение переоткрывается только по команде", async () => {
    createEmbeddedWallet.mockRejectedValue(new Error("enclave down"));
    render();
    await settle();
    expect(createEmbeddedWallet).toHaveBeenCalledTimes(1);

    createEmbeddedProvider.mockReturnValue({ mock: "provider" });
  createEmbeddedWallet.mockImplementation(async () => ({
      address: "0xwallet",
      account: { signMessage: vi.fn(async () => "0xsig") },
    }));
    await act(async () => {
      seen.value?.retryResolve();
    });
    await settle();
    expect(createEmbeddedWallet).toHaveBeenCalledTimes(2);
    expect(seen.value?.embedded).toEqual({ kind: "ready", address: "0xwallet" });
  });

  it("пока кит восстанавливает сессию, личность помечена restoring", async () => {
    turnkey = {
      authState: "unauthenticated",
      session: undefined,
      clientState: "loading",
    };
    render();
    await settle();
    expect(seen.value?.subOrgId).toBeNull();
    expect(seen.value?.restoring).toBe(true);

    turnkey = {
      authState: "authenticated",
      session: { organizationId: "sub-1" },
      clientState: "ready",
    };
    render();
    await settle();
    expect(seen.value?.restoring).toBe(false);
  });

  it("пока личности нет, наружу отдаётся idle, а не «разрешаем»", async () => {
    turnkey = { authState: "unauthenticated", session: null } as never;
    render();
    await settle();
    expect(seen.value?.embedded.kind).toBe("idle");
  });
});

describe("подключение к wagmi", () => {
  it("не повторяет неудавшуюся попытку", async () => {
    render();
    await settle();
    expect(connect).toHaveBeenCalledTimes(1);
    render();
    await settle();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("после разрыва живого соединения пробует снова", async () => {
    render();
    await settle();
    expect(connect).toHaveBeenCalledTimes(1);

    wagmi = { ...wagmi, isConnected: true, address: "0xWALLET" };
    render();
    await settle();

    wagmi = { ...wagmi, isConnected: false, address: undefined };
    render();
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe("гигиена сессии", () => {
  it("первое появление личности ничего не роняет", async () => {
    render();
    await settle();
    expect(clearToken).not.toHaveBeenCalled();
  });

  it("смена личности роняет токен и приватные кэши", async () => {
    render();
    await settle();
    turnkey = { authState: "authenticated", session: { organizationId: "sub-2" }, clientState: "ready" };
    render();
    await settle();
    expect(clearToken).toHaveBeenCalled();
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ["positions"] });
  });

  it("токен от другого кошелька роняет сессию", async () => {
    render();
    await settle();
    gatewayToken = "0xother";
    wagmi = { ...wagmi, address: "0xWALLET", isConnected: true };
    render();
    await settle();
    expect(clearToken).toHaveBeenCalled();
  });
});
