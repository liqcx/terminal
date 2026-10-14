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
 * Строки, а не `ClientState` кита: перечисление не реэкспортируется ни
 * `@liq/react`, ни корнем `@turnkey/react-wallet-kit`.
 */
export function turnkeyRestoring(clientState: string | undefined): boolean {
  return clientState !== "ready" && clientState !== "error";
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
