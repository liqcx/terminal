import { ToastCard } from "@/components/ui/toast";
import { useToastStore } from "../../stores/useToastStore";
import { useOrderOutcomeToasts } from "./useOrderOutcomeToasts";

/** Тосты исходов ордеров: подписка на поток счёта и сами тосты. */
export function OrderOutcomeToasts() {
  useOrderOutcomeToasts();
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
