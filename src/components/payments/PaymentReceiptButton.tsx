import { useState } from "react";
import { ExternalLink, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolvePaymentReceiptUrl } from "@/lib/payments/paymentReceiptResolver";

type Props = {
  paymentId: string;
  label?: string;
  showLabel?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
};

export function PaymentReceiptButton({
  paymentId,
  label = "Открыть чек",
  showLabel = true,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: Props) {
  const [loading, setLoading] = useState(false);

  const openReceipt = async () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const url = await resolvePaymentReceiptUrl(paymentId);
      if (popup && !popup.closed) popup.location.replace(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      popup?.close();
      toast.error("Не удалось получить актуальный чек", {
        description: "Попробуйте ещё раз. Просроченная ссылка Stripe не будет открыта.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("gap-2", className)}
      onClick={openReceipt}
      disabled={disabled || loading}
      title={label}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
      {showLabel && <span>{label}</span>}
      {showLabel && !loading && <ExternalLink className="h-3.5 w-3.5" />}
    </Button>
  );
}
