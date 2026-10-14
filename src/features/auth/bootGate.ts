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
 * Значения `ClientState` кита — строки `"loading"` / `"ready"` / `"error"`
 * (`@turnkey/react-wallet-kit/dist/types/base.mjs:41-43`). Корень кита
 * перечисление реэкспортирует, но единственный прямой импорт из `@turnkey/*` в
 * приложении — `styles.css` (дизайн-спека входа через Turnkey), и чистый
 * предикат не тянет весь кит в юнит-тест, поэтому сравнивает по значению.
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
