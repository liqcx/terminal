import { enterTerminal } from "../pages/flows";
import { AccountPanelPage } from "../pages/TerminalPanels";
import { WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import { longPositionFixture, readyWorld } from "../support/world";

test.describe("панель Account", () => {
  test("шесть строк макета на месте", async ({ page, world }) => {
    await enterTerminal(page, world);
    const account = new AccountPanelPage(page);

    // Стоимости счёта на карточке нет с #50 — то же число стоит в шапке
    // рынка как `margin`; Deposit / Withdraw тоже переехали в шапку.
    await expect(account.root).toBeVisible();
    for (const name of [
      "unrealized-pnl",
      "equity",
      "in-orders",
      "borrowed",
      "exposure",
      "leverage",
    ]) {
      await expect(account.row(name)).toBeVisible();
    }
  });

  test("equity = available, офчейн-лок — отдельной строкой «In orders»", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () =>
      readyWorld({
        accountMargin: {
          available: (5_000n * WAD).toString(),
          locked: (40n * WAD).toString(),
          free: (4_960n * WAD).toString(),
        },
      }),
    );
    const account = new AccountPanelPage(page);

    // Equity — ончейн getAvailableMargin (5 000 в readyWorld): выставленный
    // ордер её не двигает (решение 3, TRM-40); лок со шлюза — «In orders».
    await expect(account.row("equity")).toHaveText("$5,000.00");
    await expect(account.row("in-orders")).toHaveText("$40.00");
  });

  test("экспозиция и нереализованный PnL считаются по открытым позициям", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });
    const account = new AccountPanelPage(page);

    // +$100 из фикстуры позиции; экспозиция = 1 BTC × mark 70 000.
    await expect(account.row("unrealized-pnl")).toHaveText("+$100.00");
    await expect(account.row("exposure")).toHaveText("$70,000.00");
  });
});
