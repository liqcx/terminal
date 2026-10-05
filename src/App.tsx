import { useAccount } from "wagmi";

import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import { AccountPage } from "./features/account/AccountPage";
import { SessionGate } from "./features/auth/SessionGate";
import { OrderOutcomeToasts } from "./features/orders/OrderOutcomeToasts";
import { ConnectButton } from "./features/wallet/ConnectButton";
import { MarketProvider } from "./features/market/MarketContext";
import { Terminal } from "./features/terminal/Terminal";
import { accountHref, TRADE_HREF, useHashRoute } from "./lib/hashRoute";

/**
 * Оболочка экрана.
 *
 * @remarks `h-full` + `min-h-0` по всей цепочке до панелей: терминал делит
 * ИМЕЮЩУЮСЯ высоту окна, а не растёт под свой контент. `min-h-[600px]` — предел,
 * ниже которого делить уже нечего: вместо схлопывания панелей до нечитаемых
 * полосок страница отдаёт вертикальный скролл.
 */
export default function App() {
  const route = useHashRoute();
  const onAccount = route.view === "account";
  // Кошелёк — ключ тостов: A→B→A быстрее сборки кеша счёта обходится без
  // размонтирования гейта, и тост B показался бы под A.
  const { address } = useAccount();
  return (
    <MarketProvider>
      <ToastProvider swipeDirection="right">
        <div
          className="flex h-full min-h-[600px] flex-col"
          data-testid="app-root"
        >
          <header className="flex shrink-0 items-center gap-4 border-b border-border bg-surface-2 px-4 py-1.5">
            <span className="font-bold tracking-wide" data-testid="app-brand">
              ◢ terminal
            </span>
            {/* Два вида — две ссылки на хеш; роутера в терминале нет (см. hashRoute). */}
            <nav className="flex items-center gap-3 text-sm" aria-label="Primary">
              <a
                href={TRADE_HREF}
                aria-current={onAccount ? undefined : "page"}
                data-testid="nav-trade"
                className={
                  onAccount ? "text-muted hover:text-text" : "font-semibold text-text"
                }
              >
                Trade
              </a>
              <a
                href={accountHref("overview")}
                aria-current={onAccount ? "page" : undefined}
                data-testid="nav-account"
                className={
                  onAccount ? "font-semibold text-text" : "text-muted hover:text-text"
                }
              >
                Account
              </a>
            </nav>
            <div className="flex-1" />
            <ConnectButton />
          </header>
          <main className="flex min-h-0 flex-1 flex-col p-2">
            <SessionGate>
              {/* Вне переключателя страниц: исход ордера виден и на странице счёта. */}
              <OrderOutcomeToasts key={address ?? ""} />
              {/* Терминал размонтируется на странице счёта: кеш react-query
                  переживает, SSE переподписывается при возврате. */}
              {route.view === "account" ? (
                <AccountPage tab={route.tab} />
              ) : (
                <Terminal />
              )}
            </SessionGate>
          </main>
        </div>
        <ToastViewport />
      </ToastProvider>
    </MarketProvider>
  );
}
