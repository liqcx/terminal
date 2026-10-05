import { useEffect } from "react";

import { ToastCard } from "@/components/ui/toast";
import { clearToasts, useToastStore } from "../../stores/useToastStore";
import { useOrderOutcomeToasts } from "./useOrderOutcomeToasts";

/** Тосты исходов ордеров: подписка на поток счёта и сами тосты. */
export function OrderOutcomeToasts() {
  useOrderOutcomeToasts();
  // Очередь живёт, пока смонтирован этот компонент: SessionGate снимает его при
  // отключении, не той сети и загрузке счёта, а `key` по кошельку в App —
  // при смене кошелька (в том числе A→B→A без загрузки: кеш счёта жив).
  // На переходах Trade/Account компонент остаётся — залипшая ошибка
  // переживает страницу.
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
