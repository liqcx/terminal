import { formatUsd } from "@liq/core";
import {
  useAccountId,
  usePortfolioQuery,
  useSettlementLedgerQuery,
} from "@liq/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { accountHref } from "@/lib/hashRoute";

import {
  DASH,
  fmtLeverage,
  fmtSignedPctNum,
  fmtSignedUsd,
  fmtSignedUsdNum,
  fmtTime,
  fmtUsdNum,
} from "../../lib/format";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";
import { Panel, Stat, Unavailable } from "./AccountCards";
import {
  ACTIVITY_LABEL,
  activityRows,
  fmtUsageWad,
  pnlSeries,
  windowPnl,
  type ActivityRow,
} from "./accountLogic";
import { DepositDialog } from "./DepositDialog";
import { PnlChart } from "./PnlChart";
import { useAccountSummary } from "./useAccountSummary";
import { useCollateralBalances } from "./useCollateralBalances";
import { WithdrawDialog } from "./WithdrawDialog";

/** Сколько строк ленты показывает Overview; остальное — во вкладке Transactions. */
const RECENT = 5;

export function OverviewTab() {
  const accountId = useAccountId();
  const { summary } = useAccountSummary();
  const { markets } = useSelectedMarket();
  // Два окна портфеля: `1d` — Today's PnL, `30d` — события депозитов/выводов
  // для ленты. Lifetime-сводка (объём) одна и та же в обоих ответах.
  const {
    data: today,
    isPending: todayPending,
    isError: todayFailed,
  } = usePortfolioQuery(accountId, "1d");
  const {
    data: month,
    isPending: monthPending,
    isError: monthFailed,
  } = usePortfolioQuery(accountId, "30d");
  const {
    data: ledger,
    isPending: ledgerPending,
    isError: ledgerFailed,
  } = useSettlementLedgerQuery(accountId, {
    limit: RECENT,
  });
  const { balances, totalWad } = useCollateralBalances();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const pnl = today?.available ? windowPnl(today.points) : undefined;
  const series = useMemo(
    () => (today?.available ? pnlSeries(today.points) : []),
    [today],
  );
  // «≈»: сервер применил приближение или не дочитал историю — числа не
  // подменяем, но и за точные не выдаём.
  const approx =
    today?.summary.estimated || today?.coverage?.eventsComplete === false
      ? "≈"
      : "";
  const activity = useMemo(
    () =>
      activityRows(
        month?.available ? month.collateralEvents : [],
        ledger?.rows ?? [],
      ).slice(0, RECENT),
    [month, ledger],
  );
  // Лента живёт на двух запросах, и у неё три состояния, а не два: пока хоть
  // один не ответил — не утверждаем «событий нет», а упавший запрос — не пустой.
  const activityPending = monthPending || ledgerPending;
  const activityFailed = monthFailed || ledgerFailed;
  const heldAssets = balances.filter((b) => (b.amount ?? 0n) > 0n).length;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Stat
          label="Trading volume · all time"
          testid="account-stat-volume"
          value={today?.available ? fmtUsdNum(today.summary.volumeUsd) : DASH}
        />
        <Stat
          label="Account value"
          testid="account-stat-value"
          value={
            summary.accountValue === undefined
              ? DASH
              : formatUsd(summary.accountValue)
          }
          link={{ href: accountHref("portfolio"), text: "View portfolio" }}
        />
        <Stat
          label="Unrealized PnL"
          testid="account-stat-upnl"
          tone={summary.unrealizedPnl < 0n ? "text-short" : "text-long"}
          value={fmtSignedUsd(summary.unrealizedPnl)}
        />
        <Stat
          label="Account leverage"
          testid="account-stat-leverage"
          value={
            summary.leverage === undefined
              ? DASH
              : fmtLeverage(summary.leverage)
          }
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* `min-w-0`: ячейка грида по умолчанию не сжимается уже своего
            min-content, а таблица lightweight-charts держит прежнюю ширину —
            без этого карточка вылезает за экран на узком окне. */}
        <Panel className="flex min-w-0 flex-col gap-3 md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-muted">Today's PnL</div>
              <div
                className={`text-xl font-semibold tabular-nums ${
                  pnl === undefined
                    ? "text-text"
                    : pnl.pnlUsd < 0
                      ? "text-short"
                      : "text-long"
                }`}
                data-testid="today-pnl"
              >
                {pnl
                  ? `${approx}${fmtSignedUsdNum(pnl.pnlUsd)}${
                      pnl.pct === null ? "" : ` (${fmtSignedPctNum(pnl.pct)})`
                    }`
                  : DASH}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setDepositOpen(true)}
                data-testid="account-deposit-button"
              >
                Deposit
              </Button>
              <Button
                variant="ghost"
                onClick={() => setWithdrawOpen(true)}
                data-testid="account-withdraw-button"
              >
                Withdraw
              </Button>
            </div>
          </div>
          <div className="h-56">
            {today?.available === false || todayFailed ? (
              <Unavailable />
            ) : todayPending ? null : (
              <PnlChart
                series={series}
                testid="today-pnl-chart"
                emptyText="No data for today"
              />
            )}
          </div>
        </Panel>

        <Panel className="flex flex-col gap-1" testid="recent-activity">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold">Recent activity</span>
            <a
              href={accountHref("transactions")}
              className="text-xs text-accent hover:underline"
            >
              View all →
            </a>
          </div>
          {/* Та же подпись, что во вкладке Transactions: `available: false`
              значит «депозиты и выводы неизвестны», а не «их не было», —
              строки леджера ниже рисуются как обычно. */}
          {!activityPending &&
            !activityFailed &&
            month?.available === false && (
              <p
                className="text-xs text-muted"
                data-testid="recent-activity-events-unavailable"
              >
                Deposits and withdrawals are unavailable on this gateway
              </p>
            )}
          {activityPending ? null : activityFailed ? (
            // Не `Unavailable`: та карточка говорит про историю портфеля, а
            // лента стоит ещё и на леджере — и второй `portfolio-unavailable`
            // на странице сделал бы этот testid неоднозначным для e2e.
            <p
              className="py-6 text-center text-xs text-muted"
              data-testid="recent-activity-unavailable"
            >
              Activity history is unavailable on this gateway
            </p>
          ) : activity.length === 0 ? (
            <p
              className="py-6 text-center text-xs text-muted"
              data-testid="recent-activity-empty"
            >
              No recent activity yet
            </p>
          ) : (
            // Ключ — как в TransactionsTab: `row.id` события
            // (`type-timestamp-collateralId-amountUsd`) может совпасть у двух
            // одинаковых по секунде депозитов, индекс их различает.
            activity.map((row, i) => (
              <ActivityLine
                key={`${row.id}-${i}`}
                row={row}
                symbol={
                  row.marketId === undefined
                    ? undefined
                    : marketSymbol(markets, row.marketId)
                }
              />
            ))
          )}
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Stat
          label="Trading"
          testid="account-card-trading"
          value={
            summary.equity === undefined ? DASH : formatUsd(summary.equity)
          }
          sub={`Margin usage ${
            fmtUsageWad(summary.marginUsage)
          }`}
          link={{ href: accountHref("portfolio"), text: "View portfolio" }}
        />
        <Stat
          label="Assets"
          testid="account-card-assets"
          value={totalWad === undefined ? DASH : formatUsd(totalWad)}
          // Счёт держимых токенов честен только когда прочитаны все остатки:
          // непрочитанный остаток неотличим от нулевого, и «0 assets» под
          // прочерком читалось бы как «активов нет».
          sub={
            totalWad === undefined
              ? DASH
              : `${heldAssets} ${heldAssets === 1 ? "asset" : "assets"}`
          }
          link={{ href: accountHref("assets"), text: "View assets" }}
        />
      </div>

      <DepositDialog open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawDialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
      />
    </>
  );
}

function ActivityLine({ row, symbol }: { row: ActivityRow; symbol?: string }) {
  const tone =
    row.amountUsd === null
      ? "text-muted"
      : row.amountUsd < 0
        ? "text-short"
        : "text-long";
  return (
    <div
      className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-xs last:border-b-0"
      data-testid="recent-activity-row"
    >
      <div className="flex flex-col">
        <span>
          {ACTIVITY_LABEL[row.kind]}
          {symbol ? ` · ${symbol}` : ""}
        </span>
        <span className="text-muted">{fmtTime(row.timestampMs)}</span>
      </div>
      <span className={`tabular-nums ${tone}`}>
        {row.amountUsd === null ? DASH : fmtSignedUsdNum(row.amountUsd)}
      </span>
    </div>
  );
}
