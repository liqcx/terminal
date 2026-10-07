import type { Page } from "@playwright/test";

/**
 * Дожидается первых ответов обоих списков ордеров: открытого (спрашивает
 * `TRIGGERED`) и условного (`TRIGGER_PENDING`).
 *
 * @remarks Для тестов на «ордера нет в строке»: пока список не пришёл, строка
 * пуста и по этой причине, и тест на отрицание проходил бы вхолостую. Вызвать
 * до `enterTerminal` — запросы идут сразу после входа — и `await` после.
 */
export function orderListsLoaded(page: Page): Promise<unknown> {
  const asked = (status: string) => (response: { url(): string }) => {
    const wanted = new URL(response.url()).searchParams.get("status");
    return wanted?.split(",").includes(status) ?? false;
  };
  return Promise.all([
    page.waitForResponse(asked("TRIGGERED")),
    page.waitForResponse(asked("TRIGGER_PENDING")),
  ]);
}
