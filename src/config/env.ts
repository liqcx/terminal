/**
 * Resolves the gateway base URL, failing loud when it is missing.
 *
 * A blank `VITE_GATEWAY_URL` used to silently become `baseUrl: ""`, which makes
 * every gateway call (the SIWE `/auth/nonce` that opens sign-in, `/markets`, SSE)
 * hit a relative URL and fail with no visible cause — the "dead Sign In button".
 * Refusing to boot without it surfaces the real problem at startup instead.
 */
function requireGatewayUrl(): string {
  const url = (import.meta.env.VITE_GATEWAY_URL ?? "").replace(/\/$/, "");
  if (!url) {
    throw new Error(
      "VITE_GATEWAY_URL is not set. Without it the terminal cannot reach the " +
        "order-gateway, so sign-in (SIWE) and every gateway request fail " +
        "silently. Copy .env.example to .env and set VITE_GATEWAY_URL " +
        "(e.g. https://staging.liqu.si/v1 — include the /v1 version prefix).",
    );
  }
  return url;
}

/**
 * Кошелёк для hermetic e2e (`VITE_E2E_WALLET`): вместо Turnkey — `window.ethereum`,
 * который ставит Playwright. Константа времени сборки, выставляется только
 * конфигами Playwright; в продовой сборке ветка мёртвая и вырезается.
 * Замокать сам Turnkey (auth-proxy, сессия, стампер в IndexedDB, подпись в
 * api.turnkey.com) в браузере без сети негде — отсюда отдельная дверь для тестов.
 *
 * Именно отдельный экспорт, а не поле `env`: `import.meta.env.*` подставляется
 * при сборке, и голую константу минификатор сворачивает в `false` вместе с
 * веткой, а чтение поля объекта — нет.
 */
export const e2eWallet = import.meta.env.VITE_E2E_WALLET === "true";

/**
 * Конфигурация Turnkey. Вход — только через Turnkey, поэтому org-id и
 * auth-proxy-config-id обязательны; `enabled` (`VITE_TURNKEY_SESSION`) —
 * отдельный флаг бэкенда **сессионных ключей**: он выбирает ИСТОЧНИК ключа
 * (анклав против ключа в localStorage), а не наличие сессии. Выключен — SDK
 * возвращает кошельковый менеджер, 1-click работает без анклава.
 */
const turnkey = {
  enabled: import.meta.env.VITE_TURNKEY_SESSION === "true",
  orgId: import.meta.env.VITE_TURNKEY_ORG_ID ?? "",
  authProxyUrl:
    import.meta.env.VITE_TURNKEY_AUTH_PROXY_URL ??
    "https://authproxy.turnkey.com",
  authProxyConfigId: import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID ?? "",
};

/**
 * Чего не хватает двери входа — или `null`, если всё на месте.
 *
 * @remarks Константа времени сборки, и это несущее свойство, а не деталь:
 * `useTurnkey()` бросает вне своего провайдера, поэтому компонент, который его
 * зовёт, обязан выйти ДО первого хука. Ветка, стоящая на константе, не меняется
 * за время монтирования — правило хуков соблюдено в обеих ветках.
 */
function readTurnkeyConfigError(): string | null {
  if (e2eWallet) return null;
  const missing = [
    turnkey.orgId ? null : "VITE_TURNKEY_ORG_ID",
    turnkey.authProxyConfigId ? null : "VITE_TURNKEY_AUTH_PROXY_CONFIG_ID",
  ].filter((name): name is string => name !== null);
  if (missing.length === 0) return null;
  return `Не задано: ${missing.join(", ")}. Вход через Turnkey — единственный, без них войти нельзя.`;
}

export const env = {
  gatewayUrl: requireGatewayUrl(),
  /** Подмена RPC — hermetic e2e ставит свой origin; без неё RPC из SDK (см. `chain.ts`). */
  rpcUrl: (import.meta.env.VITE_RPC_URL as string | undefined) || undefined,
  walletConnectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  turnkey,
  turnkeyConfigError: readTurnkeyConfigError(),
};

/**
 * Смонтирована ли дверь Turnkey (обёртка, личность, кнопка входа). Одно имя
 * вместо повторения условия в пяти местах: разъехавшиеся копии этого условия —
 * это экран, на котором кнопка входа есть, а провайдера под ней нет.
 */
export const turnkeyLoginEnabled = !e2eWallet && !env.turnkeyConfigError;
