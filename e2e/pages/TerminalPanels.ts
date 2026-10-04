/** Page Objects for the live terminal: market header, trade panel, user-info
 * tables, and the deposit / withdraw dialogs. */
import { type Locator, type Page } from "@playwright/test";

type TradeTab = "market" | "limit";
type UserTab =
  | "positions"
  | "open-orders"
  | "trade-history"
  | "order-history"
  | "position-history"
  | "funding-history"
  | "account-history";

export class MarketHeaderPanel {
  readonly root: Locator;
  readonly pill: Locator;
  readonly search: Locator;
  readonly searchInput: Locator;
  readonly price: Locator;
  readonly change: Locator;
  readonly funding: Locator;
  readonly margin: Locator;
  readonly depositButton: Locator;
  readonly withdrawButton: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId("market-header");
    this.pill = page.getByTestId("market-pill");
    this.search = page.getByTestId("market-search-popover");
    this.searchInput = page.getByTestId("market-search-input");
    this.price = page.getByTestId("market-price");
    this.change = page.getByTestId("market-change");
    this.funding = page.getByTestId("funding-rate");
    this.margin = page.getByTestId("available-margin");
    this.depositButton = page.getByTestId("open-deposit-button");
    this.withdrawButton = page.getByTestId("open-withdraw-button");
  }

  /** Все строки открытого поиска. */
  get searchRows(): Locator {
    return this.page.locator('[data-testid^="market-row-"]');
  }
  marketRow(id: string): Locator {
    return this.page.getByTestId(`market-row-${id}`);
  }
  favoriteStar(id: string): Locator {
    return this.page.getByTestId(`market-favorite-${id}`);
  }
  stat(name: string): Locator {
    return this.page.getByTestId(`stat-${name}`);
  }
  async openSearch(): Promise<void> {
    await this.pill.click();
    await this.search.waitFor();
  }
  /** Открыть поиск и выбрать рынок — путь, которым его меняет человек. */
  async pickMarket(id: string): Promise<void> {
    await this.openSearch();
    await this.marketRow(id).click();
  }

  openDeposit(): Promise<void> {
    return this.depositButton.click();
  }
  openWithdraw(): Promise<void> {
    return this.withdrawButton.click();
  }
}

export class TradePanel {
  readonly root: Locator;
  readonly submitBuy: Locator;
  readonly submitSell: Locator;
  readonly sizeInput: Locator;
  readonly sizeUnitSelect: Locator;
  readonly sizeQuoteValue: Locator;
  readonly midPriceButton: Locator;
  readonly sizePctSlider: Locator;
  readonly sizePctValue: Locator;
  readonly leverageSelect: Locator;
  readonly leverageValue: Locator;
  readonly limitPriceInput: Locator;
  readonly insufficientMargin: Locator;
  readonly orderWarning: Locator;
  readonly orderRejection: Locator;
  readonly tradeError: Locator;
  readonly orderSummary: Locator;
  readonly orderQty: Locator;
  readonly orderValue: Locator;
  readonly orderCost: Locator;
  readonly orderLiqPrice: Locator;
  readonly postOnlyFlag: Locator;
  readonly iocFlag: Locator;
  readonly reduceOnlyFlag: Locator;
  readonly tpslToggle: Locator;
  readonly entryTpInput: Locator;
  readonly entrySlInput: Locator;
  readonly entryTpslValidation: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId("trade-form");
    this.submitBuy = page.getByTestId("submit-buy-button");
    this.submitSell = page.getByTestId("submit-sell-button");
    this.sizeInput = page.getByTestId("size-input");
    this.sizeUnitSelect = page.getByTestId("size-unit-select");
    this.sizeQuoteValue = page.getByTestId("size-quote-value");
    this.midPriceButton = page.getByTestId("mid-price-button");
    this.sizePctSlider = page.getByTestId("size-pct-slider");
    this.sizePctValue = page.getByTestId("size-pct-value");
    this.leverageSelect = page.getByTestId("leverage-select");
    this.leverageValue = page.getByTestId("leverage-value");
    this.limitPriceInput = page.getByTestId("limit-price-input");
    this.insufficientMargin = page.getByTestId("insufficient-margin");
    this.orderWarning = page.getByTestId("order-warning");
    this.orderRejection = page.getByTestId("order-rejection");
    this.tradeError = page.getByTestId("trade-error");
    this.orderSummary = page.getByTestId("order-summary");
    this.orderQty = page.getByTestId("order-qty");
    this.orderValue = page.getByTestId("order-value");
    this.orderCost = page.getByTestId("order-cost");
    this.orderLiqPrice = page.getByTestId("order-liq-price");
    this.postOnlyFlag = page.getByTestId("flag-post-only");
    this.iocFlag = page.getByTestId("flag-ioc");
    this.reduceOnlyFlag = page.getByTestId("flag-reduce-only");
    this.tpslToggle = page.getByTestId("tpsl-toggle");
    this.entryTpInput = page.getByTestId("entry-tp-input");
    this.entrySlInput = page.getByTestId("entry-sl-input");
    this.entryTpslValidation = page.getByTestId("entry-tpsl-validation");
  }

  tab(tab: TradeTab): Locator {
    return this.page.getByTestId(`trade-tab-${tab}`);
  }
  selectTab(tab: TradeTab): Promise<void> {
    return this.tab(tab).click();
  }
  setSize(value: string): Promise<void> {
    return this.sizeInput.fill(value);
  }
  /** Единицы выбираются списком: в поле их две, и обе названы. */
  async setSizeUnit(unit: "base" | "usd"): Promise<void> {
    await this.sizeUnitSelect.click();
    await this.page.getByTestId(`size-unit-${unit}`).click();
  }
  /** Ручка ползунка доли — единственный интерактивный узел внутри блока. */
  get sizePctThumb(): Locator {
    return this.sizePctSlider.getByRole("slider");
  }
  /** 100% покупательной способности: у ползунка это `End`. */
  async clickMax(): Promise<void> {
    await this.setSizePct(100);
  }
  /**
   * Доля покупательной способности.
   *
   * @remarks Ползунок ведётся клавиатурой, а не установкой `value`: у radix
   * значение живёт в состоянии React, а не в DOM-узле, и присвоение атрибута
   * до него не доходит. `Home` уводит в ноль, каждый `ArrowRight` добавляет
   * ступень в 25% — поэтому метод принимает только кратные 25.
   */
  async setSizePct(value: number): Promise<void> {
    if (value % 25 !== 0) {
      throw new Error(`ползунок шагает четвертями, а не на ${value}%`);
    }
    await this.sizePctThumb.focus();
    await this.page.keyboard.press("Home");
    for (let i = 0; i < value / 25; i++) {
      await this.page.keyboard.press("ArrowRight");
    }
  }
  clickSizePct(pct: 25 | 50 | 75 | 100): Promise<void> {
    return this.setSizePct(pct);
  }
  setLimitPrice(value: string): Promise<void> {
    return this.limitPriceInput.fill(value);
  }

  /**
   * Плечо выбирается списком, а не ползунком: список принимает только те
   * значения, которые допускает рынок, — ползунок принимал любое целое.
   */
  async setLeverage(value: number): Promise<void> {
    await this.leverageSelect.click();
    await this.page.getByTestId(`leverage-option-${value}`).click();
  }

  /**
   * Кнопка подачи выбранной стороны.
   *
   * @remarks Гейт скобок входа — свой на сторону: скобки, годные обеим
   * кнопкам, не гасят ни одну — как и сценарии без TP/SL, где гейт скобок
   * вообще не участвует, — поэтому проверки доступности форм-гейта по-прежнему
   * хватает на одной, и по умолчанию это покупка.
   */
  submitButtonFor(side: "buy" | "sell" = "buy"): Locator {
    return side === "buy" ? this.submitBuy : this.submitSell;
  }
  /** Тикет больше не хранит сторону: её называет нажатие. */
  submit(side: "buy" | "sell" = "buy"): Promise<void> {
    return this.submitButtonFor(side).click();
  }
  get submitButton(): Locator {
    return this.submitBuy;
  }
}

export class OrderBookPanel {
  readonly root: Locator;
  readonly loading: Locator;
  readonly unavailable: Locator;
  readonly empty: Locator;
  readonly error: Locator;
  readonly noMarket: Locator;
  readonly asks: Locator;
  readonly bids: Locator;
  readonly spread: Locator;
  readonly imbalance: Locator;
  readonly tapeRows: Locator;
  readonly tapeEmpty: Locator;
  readonly tapeLoading: Locator;
  readonly tapeNoMarket: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId("orderbook-panel");
    this.loading = page.getByTestId("book-loading");
    this.unavailable = page.getByTestId("book-unavailable");
    this.empty = page.getByTestId("book-empty");
    this.error = page.getByTestId("book-error");
    this.noMarket = page.getByTestId("book-no-market");
    this.asks = page.locator('[data-testid^="book-ask-"]');
    this.bids = page.locator('[data-testid^="book-bid-"]');
    this.spread = page.getByTestId("book-spread");
    this.imbalance = page.getByTestId("book-imbalance");
    this.tapeRows = page.locator('[data-testid^="tape-row-"]');
    this.tapeEmpty = page.getByTestId("tape-empty");
    this.tapeLoading = page.getByTestId("tape-loading");
    this.tapeNoMarket = page.getByTestId("tape-no-market");
  }

  tab(name: "book" | "trades"): Locator {
    return this.page.getByTestId(`orderbook-tab-${name}`);
  }

  selectTab(name: "book" | "trades"): Promise<void> {
    return this.tab(name).click();
  }

  askRow(i: number): Locator {
    return this.page.getByTestId(`book-ask-${i}`);
  }
  bidRow(i: number): Locator {
    return this.page.getByTestId(`book-bid-${i}`);
  }
  setView(v: "both" | "bids" | "asks"): Promise<void> {
    return this.page.getByTestId(`book-view-${v}`).click();
  }
  async selectTick(index: number): Promise<void> {
    await this.page.getByTestId("book-tick-select").click();
    await this.page.getByTestId(`book-tick-option-${index}`).click();
  }
}

export class LayoutPanel {
  readonly chartPanel: Locator;
  readonly chartCollapseToggle: Locator;
  readonly bottomPanel: Locator;
  readonly bottomFullscreenToggle: Locator;

  constructor(page: Page) {
    this.chartPanel = page.getByTestId("chart-panel");
    this.chartCollapseToggle = page.getByTestId("chart-collapse-toggle");
    this.bottomPanel = page.getByTestId("bottom-panel");
    this.bottomFullscreenToggle = page.getByTestId("bottom-fullscreen-toggle");
  }

  toggleChart(): Promise<void> {
    return this.chartCollapseToggle.click();
  }

  toggleBottomFullscreen(): Promise<void> {
    return this.bottomFullscreenToggle.click();
  }
}

export class UserInfoPanel {
  constructor(private readonly page: Page) {}

  tab(tab: UserTab): Locator {
    return this.page.getByTestId(`userinfo-tab-${tab}`);
  }
  selectTab(tab: UserTab): Promise<void> {
    return this.tab(tab).click();
  }

  get positionsLoading(): Locator {
    return this.page.getByTestId("positions-table-loading");
  }
  get positionsTable(): Locator {
    return this.page.getByTestId("positions-table");
  }
  get positionsEmpty(): Locator {
    return this.page.getByTestId("positions-table-empty");
  }
  positionRow(marketId: string): Locator {
    return this.page.getByTestId(`positions-table-row-${marketId}`);
  }
  closePosition(marketId: string): Locator {
    return this.page.getByTestId(`close-position-${marketId}`);
  }
  get closeAll(): Locator {
    return this.page.getByTestId("close-all-button");
  }
  get closeDialog(): Locator {
    return this.page.getByTestId("close-positions-dialog");
  }
  get closeConfirm(): Locator {
    return this.page.getByTestId("close-positions-confirm");
  }
  editTpSl(marketId: string): Locator {
    return this.page.getByTestId(`edit-tpsl-${marketId}`);
  }
  get tpslDialog(): Locator {
    return this.page.getByTestId("tpsl-dialog");
  }
  get tpslTp(): Locator {
    return this.page.getByTestId("tpsl-tp-input");
  }
  get tpslSl(): Locator {
    return this.page.getByTestId("tpsl-sl-input");
  }
  get tpslSave(): Locator {
    return this.page.getByTestId("tpsl-save");
  }
  get tpslError(): Locator {
    return this.page.getByTestId("tpsl-error");
  }
  get tpslValidation(): Locator {
    return this.page.getByTestId("tpsl-validation");
  }
  get tpslWarning(): Locator {
    return this.page.getByTestId("tpsl-warning");
  }

  get ordersTable(): Locator {
    return this.page.getByTestId("orders-table");
  }
  get ordersEmpty(): Locator {
    return this.page.getByTestId("orders-table-empty");
  }
  orderRow(id: string): Locator {
    return this.page.getByTestId(`orders-table-row-${id}`);
  }
  cancelOrder(id: string): Promise<void> {
    return this.page.getByTestId(`cancel-order-${id}`).click();
  }

  get historyTable(): Locator {
    return this.page.getByTestId("trade-history-table");
  }
  get historyEmpty(): Locator {
    return this.page.getByTestId("trade-history-table-empty");
  }
  tradeRow(id: string): Locator {
    return this.page.getByTestId(`trade-history-table-row-${id}`);
  }

  get columnsButton(): Locator {
    return this.page.getByTestId("table-columns-button");
  }
  get columnsMenu(): Locator {
    return this.page.getByTestId("table-columns-menu");
  }
  columnToggle(id: string): Locator {
    return this.page.getByTestId(`table-column-toggle-${id}`);
  }
  get filterButton(): Locator {
    return this.page.getByTestId("table-filter-button");
  }
  filterOption(marketId: string): Locator {
    return this.page.getByTestId(`table-filter-option-${marketId}`);
  }
  header(columnId: string): Locator {
    return this.page.getByTestId(`table-header-${columnId}`);
  }
}

export class DepositDialog {
  readonly root: Locator;
  readonly overlay: Locator;
  readonly amountInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly error: Locator;
  readonly balance: Locator;
  readonly maxButton: Locator;
  readonly validation: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId("deposit-dialog");
    this.overlay = page.getByTestId("dialog-overlay");
    this.amountInput = page.getByTestId("deposit-amount-input");
    this.submitButton = page.getByTestId("deposit-submit-button");
    this.cancelButton = page.getByTestId("deposit-cancel-button");
    this.error = page.getByTestId("deposit-error");
    this.balance = page.getByTestId("deposit-balance");
    this.maxButton = page.getByTestId("deposit-max-button");
    this.validation = page.getByTestId("deposit-validation");
  }

  /** Вкладка токена (USDC | USDm); есть только когда у контура больше одного. */
  token(symbol: string): Locator {
    return this.root.getByTestId(`deposit-token-${symbol}`);
  }

  async deposit(amount: string): Promise<void> {
    await this.amountInput.fill(amount);
    await this.submitButton.click();
  }
}

export class WithdrawDialog {
  readonly root: Locator;
  readonly amountInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly error: Locator;
  readonly debtNotice: Locator;
  readonly walletShort: Locator;
  readonly balance: Locator;
  readonly maxButton: Locator;
  readonly validation: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId("withdraw-dialog");
    this.amountInput = page.getByTestId("withdraw-amount-input");
    this.submitButton = page.getByTestId("withdraw-submit-button");
    this.cancelButton = page.getByTestId("withdraw-cancel-button");
    this.error = page.getByTestId("withdraw-error");
    this.debtNotice = page.getByTestId("withdraw-debt-notice");
    this.walletShort = page.getByTestId("withdraw-wallet-short");
    this.balance = page.getByTestId("withdraw-balance");
    this.maxButton = page.getByTestId("withdraw-max-button");
    this.validation = page.getByTestId("withdraw-validation");
  }

  /** Вкладка токена (USDC | USDm); есть только когда у контура больше одного. */
  token(symbol: string): Locator {
    return this.root.getByTestId(`withdraw-token-${symbol}`);
  }

  async withdraw(amount: string): Promise<void> {
    await this.amountInput.fill(amount);
    await this.submitButton.click();
  }
}

export class AccountPanelPage {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId("account-panel");
  }
  row(name: string): Locator {
    return this.page.getByTestId(`account-${name}`);
  }
}

export class ChartFramePage {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId("chart-frame");
  }
  interval(iv: string): Locator {
    return this.page.getByTestId(`chart-interval-${iv}`);
  }
  scale(name: "percent" | "log" | "auto"): Locator {
    return this.page.getByTestId(`chart-scale-${name}`);
  }
}
