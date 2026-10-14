import { ClientState } from "@turnkey/react-wallet-kit";

/**
 * Восстанавливает ли кит Turnkey сессию прямо сейчас.
 *
 * @remarks
 * `clientState` кита идёт `undefined` → `"loading"` → `"ready"` | `"error"`:
 * `undefined` — конфигурация ещё грузится, `"loading"` — клиент создан и
 * читает сохранённую сессию (`get_user`, `list_wallets`…). Всё это время
 * `authState` уже `Unauthenticated`, и без этого флага гейт рисовал экран входа
 * поверх живой сессии (TRM-18). `"error"` — восстановление закончено неудачей:
 * лоадер снимается, иначе сбой конфигурации запирал бы пользователя в
 * «Loading account…» навсегда.
 *
 * Перечисление берётся из корня `@turnkey/react-wallet-kit` (`@liq/react` его не
 * реэкспортирует): сравнение с `ClientState.Ready` / `.Error` под защитой
 * typecheck, а не строк, которые тихо разойдутся при переименовании в ките.
 */
export function turnkeyRestoring(clientState: ClientState | undefined): boolean {
  return (
    clientState !== ClientState.Ready && clientState !== ClientState.Error
  );
}

/**
 * Держать ли «Loading account…» вместо гейта сессии.
 *
 * @remarks Два окна, в которые экран входа соврал бы: кит ещё не восстановил
 * сессию (`restoring`) и восстановленная личность ещё не получила встроенный
 * кошелёк (`subOrgId` есть, кошелёк `idle` / `resolving`) — второе окно гейт
 * закрывал и раньше.
 */
export function bootGateLoading(input: {
  restoring: boolean;
  subOrgId: string | null;
  embedded: "idle" | "resolving" | "ready" | "failed";
}): boolean {
  if (input.restoring) return true;
  return (
    input.subOrgId !== null &&
    (input.embedded === "idle" || input.embedded === "resolving")
  );
}
