/**
 * Idempotently drive a freshly-connected live wallet into a trade-ready
 * terminal: create the perps account if missing, sign in with SIWE, and
 * deposit a little margin if the account is empty. Reuses the Tier 1
 * Page Objects against the real backend.
 */
import { expect, type Page } from "@playwright/test";

import { AppPage } from "../pages/AppPage";
import {
  DepositDialog,
  MarketHeaderPanel,
  TradePanel,
} from "../pages/TerminalPanels";
import { liveEnv } from "./env";

export async function ensureTradeReady(page: Page): Promise<void> {
  const timeout = liveEnv.fillTimeoutMs;
  const app = new AppPage(page);

  await app.goto();
  await app.connect();

  // Wait for the session to resolve to a concrete stage.
  await expect(
    app.noAccountGate.or(app.needsSigninGate).or(app.tradeReady),
  ).toBeVisible({ timeout });

  if (await app.noAccountGate.isVisible()) {
    await app.createAccountButton.click();
    await expect(app.needsSigninGate).toBeVisible({ timeout });
  }
  if (await app.needsSigninGate.isVisible()) {
    await app.signinButton.click();
  }
  await expect(app.tradeReady).toBeVisible({ timeout });

  // Deposit a little margin if the account has none.
  const trade = new TradePanel(page);
  if (await trade.insufficientMargin.isVisible().catch(() => false)) {
    const market = new MarketHeaderPanel(page);
    await market.openDeposit();
    const deposit = new DepositDialog(page);
    await deposit.deposit("50");
    await expect(deposit.root).toBeHidden({ timeout });
    await expect(trade.insufficientMargin).toBeHidden({ timeout });
  }
}
