import type { PortfolioPeriod } from "@liq/api-client";
import { formatUsd } from "@liq/core";
import {
  useAccountId,
  usePortfolioQuery,
  useSettlementLedgerQuery,
} from "@liq/react";
import { useMemo, useState } from "react";

import {
  DASH,
  fmtSignedPctNum,
  fmtSignedUsd,
  fmtUsdNum,
} from "../../lib/format";
import { UserInfoTabs } from "../userinfo/UserInfoTabs";
import { Panel, PeriodSelect, Stat, Unavailable } from "./AccountCards";
import { fmtUsageWad, periodWindow, pnlSeries, pnlShare } from "./accountLogic";
import { PnlChart } from "./PnlChart";
import { useAccountSummary } from "./useAccountSummary";

export function PortfolioTab() {
  const accountId = useAccountId();
  const { summary } = useAccountSummary();
  const [period, setPeriod] = useState<PortfolioPeriod>("30d");
  // `now` — в состоянии, не в рендере (React 19): окно пересчитывается на
  // смене периода, а не на каждом тике.
  const [now, setNow] = useState(() => Date.now());
  const range = useMemo(() => periodWindow(period, now), [period, now]);

  const {
    data: portfolio,
    isPending: portfolioPending,
    isError: portfolioFailed,
  } = usePortfolioQuery(accountId, period);
  // Вкладка читает только `totals`: шлюз считает их по всему окну на первой
  // странице, независимо от `limit` и курсора (`SettlementLedgerTotals`), так
  // что строки здесь не нужны — одна вместо двухсот.
  const {
    data: ledger,
    isPending: ledgerPending,
    isError: ledgerFailed,
  } = useSettlementLedgerQuery(accountId, { ...range, limit: 1 });

  const series = useMemo(
    () => (portfolio?.available ? pnlSeries(portfolio.points) : []),
    [portfolio],
  );
  const totals = ledger?.totals ?? null;
  const approx = totals !== null && !totals.complete ? "≈" : "";
  const upnlPct = pnlShare(summary.unrealizedPnl, summary.accountValue);

  function changePeriod(next: PortfolioPeriod) {
    setPeriod(next);
    setNow(Date.now());
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Overview</span>
            <PeriodSelect
              value={period}
              onChange={changePeriod}
              testid="portfolio-period"
            />
          </div>
          <Metric
            label="Unrealized PnL"
            testid="portfolio-upnl"
            tone={summary.unrealizedPnl < 0n ? "text-short" : "text-long"}
            value={fmtSignedUsd(summary.unrealizedPnl)}
            sub={upnlPct === null ? undefined : fmtSignedPctNum(upnlPct)}
          />
          <Metric
            label="Portfolio value"
            testid="portfolio-value"
            value={
              summary.accountValue === undefined
                ? DASH
                : formatUsd(summary.accountValue)
            }
          />
          <Metric
            label="Trading volume · all time"
            testid="portfolio-volume"
            value={
              portfolio?.available ? fmtUsdNum(portfolio.summary.volumeUsd) : DASH
            }
          />
        </Panel>

        <Panel className="flex h-72 flex-col md:h-auto">
          {/* Три состояния запроса, не два: `available: false`/ошибка — «нет
              данных», pending — ничего (не рисуем кривую по нулю точек, это
              читалось бы как «PnL отсутствует», а не «ещё грузится»). */}
          {portfolio?.available === false || portfolioFailed ? (
            <Unavailable />
          ) : portfolioPending ? null : (
            <PnlChart series={series} testid="portfolio-pnl-chart" />
          )}
        </Panel>

        <Panel className="flex flex-col gap-2" testid="pnl-breakdown">
          <span className="text-sm font-semibold">PnL breakdown</span>
          <span className="text-[11px] text-muted">
            Selected period{approx ? " · totals incomplete" : ""}
          </span>
          {/* Тот же принцип трёх состояний, что у кривой слева: строки
              леджера не рисуются, пока запрос ещё не осел (иначе `null`→DASH
              на миг читался бы как «данных нет», хотя они просто в пути), а
              при ошибке — отдельный testid: `portfolio-unavailable` уже занят
              панелью кривой, и обе панели видны на вкладке одновременно. */}
          {ledgerPending ? null : ledgerFailed ? (
            <p
              className="py-6 text-center text-xs text-muted"
              data-testid="portfolio-breakdown-unavailable"
            >
              Settlement history is unavailable on this gateway
            </p>
          ) : (
            <>
              <BreakdownRow
                label="Realized PnL"
                value={totals?.pricePnl ?? null}
                prefix={approx}
              />
              <BreakdownRow
                label="Funding"
                value={totals?.accruedFunding ?? null}
                prefix={approx}
              />
              <BreakdownRow
                label="Trading fees"
                value={
                  totals === null || totals.totalFees === null
                    ? null
                    : -totals.totalFees
                }
                prefix={approx}
              />
              <BreakdownRow
                label="Net"
                value={totals?.netBalanceDelta ?? null}
                prefix={approx}
                strong
              />
            </>
          )}
          <div className="mt-1 border-t border-border pt-1">
            <BreakdownRow label="Unrealized (now)" value={summary.unrealizedPnl} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Stat
          label="Available to trade"
          testid="portfolio-free"
          tone={summary.free !== undefined && summary.free < 0n ? "text-short" : "text-text"}
          value={summary.free === undefined ? DASH : formatUsd(summary.free)}
        />
        <Stat
          label="Margin usage"
          testid="portfolio-margin-usage"
          value={
            fmtUsageWad(summary.marginUsage)
          }
        />
      </div>

      {/* Те же семь таблиц, что в терминале. Высота явная: таблицы меряют себя
          от flex-родителя и в потоке страницы схлопнулись бы. */}
      <div
        className="flex h-[420px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border"
        data-testid="portfolio-tables"
      >
        <UserInfoTabs fullscreenToggle={false} />
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "text-text",
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  testid: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tone}`} data-testid={testid}>
        {value}
      </span>
      {sub && <span className={`text-xs ${tone}`}>{sub}</span>}
    </div>
  );
}

/** Строка breakdown: WAD со знаком либо прочерк — `null` в леджере значит «недоказуемо». */
function BreakdownRow({
  label,
  value,
  prefix = "",
  strong = false,
}: {
  label: string;
  value: bigint | null;
  prefix?: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between text-xs ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted">{label}</span>
      <span
        className={`tabular-nums ${
          value === null ? "text-muted" : value < 0n ? "text-short" : "text-long"
        }`}
      >
        {value === null ? DASH : `${prefix}${fmtSignedUsd(value)}`}
      </span>
    </div>
  );
}
