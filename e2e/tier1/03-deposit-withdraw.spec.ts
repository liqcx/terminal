import { Margin } from "@liq/sdk";

import { enterTerminal } from "../pages/flows";
import { TEST_ADDRESS, WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import { armHold, readyWorld, releaseHold } from "../support/world";

test.describe("deposit & withdraw", () => {
  test("depositing credits margin by the entered amount and enables trading", async ({
    page,
    world,
  }) => {
    const { market, trade, deposit } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      w.accounts[0].withdrawable = 0n;
      return w;
    });

    await expect(market.margin).toHaveText(/\$0\.00/);
    await expect(trade.insufficientMargin).toBeVisible();

    await market.openDeposit();
    await expect(deposit.root).toBeVisible();
    await deposit.deposit("200");

    await expect(deposit.root).toBeHidden();
    // margin reflects the deposited amount (not a fixed mock value)
    await expect(market.margin).toHaveText(/\$200\.00/);
    await expect(trade.insufficientMargin).toBeHidden();
    // the app sent exactly the typed amount as a positive collateral delta
    expect(world.lastCollateralDelta).toBe(Margin.parse("200"));
    // …into the sUSDC slot: USDC is the default tab.
    expect(world.lastCollateralId).toBe(1n);
  });

  test("the deposit is relayed: the user only signs, the first batch carries the 7702 authorization", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      w.accounts[0].withdrawable = 0n;
      return w;
    });

    await market.openDeposit();
    await deposit.deposit("200");
    await expect(deposit.root).toBeHidden();

    // The whole promise of ADR-0063: the wallet signs and never sends. Every
    // recorded tx belongs to the relayer ("relay"), none to the wallet — so a
    // wallet holding zero ETH could have done this.
    expect(world.sentTxs.filter((t) => t.kind !== "relay")).toHaveLength(0);
    expect(world.signRequests).toContain("eth_signTypedData_v4");
    // The EOA carries no delegate yet (the mock chain answers "0x" to
    // eth_getCode), so this first batch must carry the authorization.
    expect(world.signRequests).toContain("eth_signAuthorization");

    const batch = world.relayedBatches.at(-1);
    expect(batch?.authorization).toBeDefined();
    expect(batch?.user.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    // approve → wrap → approve → modifyCollateral in ONE batch: the approvals
    // that used to be their own transactions now ride along, and no call may
    // carry ETH.
    expect(batch?.calls).toHaveLength(4);
    expect(batch?.calls.every((c) => c.value === "0")).toBe(true);
  });

  test("depositing USDm credits margin and targets its own collateral id", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      w.accounts[0].withdrawable = 0n;
      return w;
    });

    await market.openDeposit();
    await deposit.token("USDm").click();
    await expect(deposit.root).toContainText("Deposit USDm");
    await deposit.deposit("200");

    await expect(deposit.root).toBeHidden();
    await expect(market.margin).toHaveText(/\$200\.00/);
    // 18-dec token: the typed amount is credited as-is…
    expect(world.lastCollateralDelta).toBe(Margin.parse("200"));
    // …under USDm's spot market (2 on staging), not the sUSDC slot.
    expect(world.lastCollateralId).toBe(2n);
  });

  test("withdrawing debits margin by the entered amount", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // starts at $5,000

    await expect(market.margin).toHaveText(/\$5,000\.00/);
    await market.openWithdraw();
    await expect(withdraw.root).toBeVisible();
    await withdraw.withdraw("100");

    await expect(withdraw.root).toBeHidden();
    await expect(market.margin).toHaveText(/\$4,900\.00/);
    // the app sent exactly the typed amount as a negative collateral delta
    expect(world.lastCollateralDelta).toBe(-Margin.parse("100"));
    // …against the sUSDC collateral id (susdcMarketId = 1 on staging), NOT the
    // hardcoded 0 that withdrew from an empty collateral slot and reverted (#459).
    expect(world.lastCollateralId).toBe(1n);
    // Вывод тоже едет релеем. Отправителя выбирает проп `relay` у LiqSetup, и
    // это единственное, что отделяет вывод от кошелькового пути: встроенный
    // кошелёк пустой, ETH на газ у него нет. Типы потерю пропа не заметят —
    // `relay ?? false` молча откатывается, — поэтому держим утверждением.
    expect(world.sentTxs.filter((t) => t.kind !== "relay")).toHaveLength(0);
  });

  test("withdrawing USDm debits margin under its own collateral id", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // $5,000

    await market.openWithdraw();
    await withdraw.token("USDm").click();
    await expect(withdraw.root).toContainText("Withdraw USDm");
    await withdraw.withdraw("100");

    await expect(withdraw.root).toBeHidden();
    await expect(market.margin).toHaveText(/\$4,900\.00/);
    expect(world.lastCollateralDelta).toBe(-Margin.parse("100"));
    // …under USDm's spot market (2 on staging), not the sUSDC slot.
    expect(world.lastCollateralId).toBe(2n);
  });

  test("a reverted withdraw surfaces an error and leaves margin unchanged", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // $5,000
    world.faults.collateralReverts = true;

    await market.openWithdraw();
    await expect(withdraw.root).toBeVisible();
    await withdraw.withdraw("100");

    await expect(withdraw.error).toBeVisible();
    await expect(market.margin).toHaveText(/\$5,000\.00/); // unchanged
    expect(world.lastCollateralDelta).toBe(0n);
  });

  // NOTE: monorepo#434 — the SDK's deposit mutation does not surface a
  // reverted modifyCollateral as `deposit.error` (unlike withdraw). The in-repo
  // mitigation (an explicit onError) prevents the unhandled rejection; the full
  // error-UI fix needs an SDK change. This test pins the stable outcome.
  test("a reverted deposit leaves margin unchanged and sends no collateral delta", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      w.accounts[0].withdrawable = 0n;
      return w;
    });
    world.faults.collateralReverts = true;

    await market.openDeposit();
    await expect(deposit.root).toBeVisible();
    await deposit.deposit("200");

    // Deterministic outcome: no margin moved, no collateral delta recorded.
    await expect(market.margin).toHaveText(/\$0\.00/);
    expect(world.lastCollateralDelta).toBe(0n);
  });

  test("deposit submit is gated on a non-empty amount", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world);
    await market.openDeposit();

    await expect(deposit.submitButton).toBeDisabled(); // empty
    await deposit.amountInput.fill("50");
    await expect(deposit.submitButton).toBeEnabled();
    await deposit.amountInput.fill("");
    await expect(deposit.submitButton).toBeDisabled(); // cleared again
    expect(world.lastCollateralDelta).toBe(0n); // nothing was ever sent
  });

  test("cancelling the deposit dialog closes it without sending a tx", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world);
    await market.openDeposit();
    await expect(deposit.root).toBeVisible();
    await deposit.amountInput.fill("100"); // even with an amount entered…

    await deposit.cancelButton.click();
    await expect(deposit.root).toBeHidden(); // …cancel just dismisses
    expect(world.lastCollateralDelta).toBe(0n); // no collateral tx was sent
  });

  test("withdraw submit is gated on a non-empty amount", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world);
    await market.openWithdraw();

    await expect(withdraw.submitButton).toBeDisabled(); // empty
    await withdraw.amountInput.fill("50");
    await expect(withdraw.submitButton).toBeEnabled();
    await withdraw.amountInput.fill("");
    await expect(withdraw.submitButton).toBeDisabled(); // cleared again
    expect(world.lastCollateralDelta).toBe(0n); // nothing was ever sent
  });

  test("cancelling the withdraw dialog closes it without sending a tx", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world);
    await market.openWithdraw();
    await expect(withdraw.root).toBeVisible();
    await withdraw.amountInput.fill("100"); // even with an amount entered…

    await withdraw.cancelButton.click();
    await expect(withdraw.root).toBeHidden(); // …cancel just dismisses
    expect(world.lastCollateralDelta).toBe(0n); // no collateral tx was sent
  });

  test("a non-numeric withdraw amount is rejected by the input and sends no tx", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // $5,000
    await market.openWithdraw();
    // The numeric input sanitizes non-digits away, so a malformed amount can
    // never be entered — submit stays disabled and nothing is ever sent.
    await withdraw.amountInput.fill("abc");
    await expect(withdraw.amountInput).toHaveValue("");
    await expect(withdraw.submitButton).toBeDisabled();
    await expect(market.margin).toHaveText(/\$5,000\.00/);
    expect(world.lastCollateralDelta).toBe(0n);
  });

  test("deposit shows wallet balance and Max fills the field", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world);
    await market.openDeposit();

    // The displayed balance is the wallet's 6-dec USDC (1,000,000) lifted to the
    // 18-dec money domain — a regression to reading it as raw 18-dec would show
    // $1e12 here.
    await expect(deposit.balance).toHaveText(/\$1,000,000\.00/);
    await deposit.maxButton.click();
    await expect(deposit.amountInput).not.toHaveValue("");
    await expect(deposit.submitButton).toBeEnabled();
  });

  test("a deposit above wallet balance is blocked with a validation note", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world);
    await market.openDeposit();

    // Mocked wallet USDC balance is 1,000,000 — exceed it. (The deposit gates
    // on the USDC balance, the token it spends, not sUSDC.)
    await deposit.amountInput.fill("1000001");
    await expect(deposit.validation).toBeVisible();
    await expect(deposit.submitButton).toBeDisabled();
    expect(world.lastCollateralDelta).toBe(0n);
  });

  test("withdraw shows available, Max fills it, and over-balance is blocked", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // withdrawable $5,000
    await market.openWithdraw();

    await expect(withdraw.balance).toHaveText(/\$5,000\.00/);
    await withdraw.maxButton.click();
    await expect(withdraw.amountInput).toHaveValue("5000");
    await expect(withdraw.submitButton).toBeEnabled();

    // Beyond withdrawable: a hard block with a validation note — `withdrawable`
    // is the SDK's own authoritative figure, so the chain would revert.
    await withdraw.amountInput.fill("6000");
    await expect(withdraw.validation).toBeVisible();
    await expect(withdraw.submitButton).toBeDisabled();
    expect(world.lastCollateralDelta).toBe(0n);
  });

  test("clicking the dialog backdrop closes it; clicking inside does not", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world);
    await market.openDeposit();
    await expect(deposit.root).toBeVisible();

    // Click inside the panel — dialog stays open (stopPropagation).
    await deposit.root.getByText("Deposit USDC").click();
    await expect(deposit.root).toBeVisible();

    // Click the backdrop (top-left corner, outside the panel) — dialog closes.
    await deposit.overlay.click({ position: { x: 5, y: 5 } });
    await expect(deposit.root).toBeHidden();
    expect(world.lastCollateralDelta).toBe(0n);
  });

  test("the deposit button shows a pending state while the tx is in flight", async ({
    page,
    world,
  }) => {
    const { market, deposit } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      w.accounts[0].withdrawable = 0n;
      return w;
    });
    armHold(world, "collateralReceipt"); // hold the receipt → mutation stays pending

    await market.openDeposit();
    await deposit.deposit("200");

    await expect(deposit.submitButton).toHaveText(/Depositing…/);
    await expect(deposit.submitButton).toBeDisabled();

    releaseHold(world, "collateralReceipt");
    await expect(deposit.root).toBeHidden(); // settles + closes on success
    await expect(market.margin).toHaveText(/\$200\.00/);
  });

  test("the withdraw button shows a pending state while the tx is in flight", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world); // $5,000
    armHold(world, "collateralReceipt");

    await market.openWithdraw();
    await withdraw.withdraw("100");

    await expect(withdraw.submitButton).toHaveText(/Withdrawing…/);
    await expect(withdraw.submitButton).toBeDisabled();

    releaseHold(world, "collateralReceipt");
    await expect(withdraw.root).toBeHidden();
    await expect(market.margin).toHaveText(/\$4,900\.00/);
  });

  test("an account with debt offers an atomic Repay & Withdraw", async ({
    page,
    world,
  }) => {
    // Synthetix blocks withdrawals while the account carries debt; the dialog
    // surfaces it and switches the action to an atomic repay+withdraw (#453 arc).
    const { market, withdraw } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].debt = 12n * WAD; // $12 closed-at-loss debt
      return w;
    });

    await market.openWithdraw();
    await expect(withdraw.root).toBeVisible();
    await expect(withdraw.debtNotice).toBeVisible();
    await expect(withdraw.debtNotice).toContainText("12");
    await withdraw.amountInput.fill("100");
    await expect(withdraw.submitButton).toHaveText("Repay & Withdraw");
  });

  test("Repay & Withdraw is blocked when the wallet USDC cannot cover the debt", async ({
    page,
    world,
  }) => {
    // TRM-29: пустой кошелёк при долге — транзакция откатывалась без причины.
    const { market, withdraw } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].debt = 168n * WAD;
      w.walletUsdc = 100n * 10n ** 6n;
      return w;
    });

    await market.openWithdraw();
    await withdraw.amountInput.fill("1");
    await expect(withdraw.walletShort).toBeVisible();
    await expect(withdraw.walletShort).toHaveText(
      "Not enough USDC in your wallet to repay the $168.00 debt (wallet: $100.00). Top up the wallet first.",
    );
    await expect(withdraw.submitButton).toBeDisabled();
  });

  test("Repay & Withdraw stays available when the wallet covers the debt", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].debt = 168n * WAD;
      w.walletUsdc = 400n * 10n ** 6n;
      return w;
    });

    await market.openWithdraw();
    await withdraw.amountInput.fill("1");
    await expect(withdraw.submitButton).toHaveText("Repay & Withdraw");
    await expect(withdraw.submitButton).toBeEnabled();
    await expect(withdraw.walletShort).toHaveCount(0);
  });
});
