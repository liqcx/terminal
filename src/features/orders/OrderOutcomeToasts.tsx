import { useEffect } from "react";

import { ToastCard } from "@/components/ui/toast";
import { clearToasts, useToastStore } from "../../stores/useToastStore";
import { useOrderOutcomeToasts } from "./useOrderOutcomeToasts";

/** Тосты исходов ордеров: подписка на поток счёта и сами тосты. */
export function OrderOutcomeToasts() {
  useOrderOutcomeToasts();
  // SessionGate размонтирует нас при смене сессии (отключение, не та сеть):
  // тосты прежнего кошелька не должны всплыть под следующим. На переходах
  // Trade/Account мы не размонтируемся — залипшая ошибка переживает страницу.
  useEffect(() => clearToasts, []);
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return toasts.map((toast) => (
    <ToastCard
      key={toast.id}
      toast={toast}
      data-testid="order-outcome-toast"
      onOpenChange={(open) => {
        if (!open) dismiss(toast.id);
      }}
    />
  ));
}
