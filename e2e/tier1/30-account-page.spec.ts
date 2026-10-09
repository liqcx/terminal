import { AccountPage } from "../pages/AccountPage";
import { enterTerminal } from "../pages/flows";
import { WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import {
  defaultPortfolio,
  ledgerRowFixture,
  readyWorld,
} from "../support/world";

test.describe("страница Account", () => {
  test("ссылка в шапке открывает страницу с четырьмя вкладками", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world);
    const account = new AccountPage(page);
    await account.open();

    await expect(page).toHaveURL(/#\/account$/);
    for (const slug of ["overview", "portfolio", "assets", "transactions"]) {
      await expect(account.tab(slug)).toBeVisible();
    }
    await expect(account.tab("overview")).toHaveAttribute("aria-current", "page");
    // Терминал размонтирован: на странице счёта его корня нет.
    await expect(page.getByTestId("terminal-root")).toHaveCount(0);
  });

  test("Overview: стоимость счёта, PnL за день и депозит в ленте", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world);
    const account = new AccountPage(page);
    await account.open();

    // getAvailableMargin из readyWorld — 5 000.
    await expect(account.stat("value")).toHaveText("$5,000.00");
    // Две точки фикстуры: заработано 120 при старте 5 000 → +2.40%.
    await expect(account.todayPnl).toHaveText("+$120.00 (+2.40%)");
    await expect(account.activityRows.first()).toContainText("Deposit");
    await expect(account.activityRows.first()).toContainText("+$2,500.00");
  });

  test("Portfolio: использование маржи = требование / available (20.0%)", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].requiredInitialMargin = 1_000n * WAD;
      return w;
    });
    const account = new AccountPage(page);
    await account.open();
    await account.tab("portfolio").click();

    // getRequiredMargins[0] = 1 000, getAvailableMargin = 5 000.
    await expect(page.getByTestId("portfolio-margin-usage")).toHaveText("20.0%");
  });

  test("Portfolio: счёт под водой — использование «—», не 0 % и не 100 %", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = -10n * WAD;
      w.accounts[0].requiredInitialMargin = 1_000n * WAD;
      return w;
    });
    const account = new AccountPage(page);
    await account.open();
    await account.tab("portfolio").click();

    await expect(page.getByTestId("portfolio-margin-usage")).toHaveText("—");
  });

  test("Assets: строка USDC показывает остаток на аккаунте", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world);
    const account = new AccountPage(page);
    await account.open();
    await account.tab("assets").click();

    // Мок-чейн отвечает на getCollateralAmount всем available аккаунта (5 000).
    await expect(account.assetRow("USDC")).toContainText("5,000");
  });

  test("Transactions: фильтр по типу оставляет только депозиты", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () =>
      readyWorld({ settlementLedger: [ledgerRowFixture()] }),
    );
    const account = new AccountPage(page);
    await account.open();
    await account.tab("transactions").click();

    // Market-фильтра у вкладки быть не должно: экспорт CSV его не видит, и
    // экран разошёлся бы с файлом (регрессия d39df05/ad9f39d).
    await expect(page.getByTestId("table-filter-button")).toHaveCount(0);

    // Фикстуры датированы 2024-м: окно 30 дней их не видит, берём всё время.
    await account.select("transactions-period", "all");
    await expect(account.transactionRows).toHaveCount(2);
    await expect(account.transactionsTable).toContainText("Trade");

    await account.select("transactions-type", "deposit");
    await expect(account.transactionRows).toHaveCount(1);
    await expect(account.transactionRows.first()).toContainText("Deposit");
  });

  test("сабграф молчит (available: false): подпись про переводы, расчёты на месте", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () =>
      readyWorld({
        portfolio: { ...defaultPortfolio(), available: false },
        settlementLedger: [ledgerRowFixture()],
      }),
    );
    const account = new AccountPage(page);
    await account.open();

    await expect(
      page.getByTestId("recent-activity-events-unavailable"),
    ).toBeVisible();
    // Депозит из портфеля пропал вместе с сабграфом, расчёт леджера остался —
    // «неизвестно» не стирает то, что известно.
    await expect(account.activityRows).toHaveCount(1);

    await account.tab("transactions").click();
    await expect(
      page.getByTestId("transactions-events-unavailable"),
    ).toBeVisible();
    await account.select("transactions-period", "all");
    await expect(account.transactionRows).toHaveCount(1);
  });

  test("портфель отвечает 500: три панели говорят о недоступности", async ({
    page,
    world,
  }) => {
    // Два ожидания по 20 с не помещаются в бюджет теста по умолчанию (30 с) —
    // `test.slow()` даёт тройной, иначе тест умрёт раньше своих же таймаутов.
    test.slow();
    await enterTerminal(page, world, () =>
      readyWorld({ faults: { routeStatus: { portfolio: 500 } } }),
    );
    const account = new AccountPage(page);
    await account.open();

    // react-query по умолчанию повторяет запрос 3 раза с нарастающей паузой,
    // поэтому провал «оседает» секунд через десять — ждём это явным
    // таймаутом ожидания, а не сном.
    const settled = { timeout: 20_000 };
    await expect(page.getByTestId("portfolio-unavailable")).toBeVisible(settled);
    await expect(page.getByTestId("recent-activity-unavailable")).toBeVisible(
      settled,
    );

    await account.tab("transactions").click();
    await expect(page.getByTestId("transactions-unavailable")).toBeVisible(
      settled,
    );
  });

  test("ссылка Trade возвращает терминал", async ({ page, world }) => {
    await enterTerminal(page, world);
    const account = new AccountPage(page);
    await account.open();

    await account.tradeLink.click();
    await expect(page.getByTestId("terminal-root")).toBeVisible();
    await expect(account.root).toHaveCount(0);
  });
});
