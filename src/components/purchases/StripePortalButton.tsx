// Phase 3.3 — Кнопка управления подпиской через Stripe Customer Portal.
// Phase 3.4 — режим recovery для подписок с проблемой оплаты.
// Видна только если у подписки provider='stripe'. Открывает Stripe Hosted Portal.
// На UI английских терминов (Portal / Customer Portal / Dunning / Recovery) нет.

import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface StripePortalButtonProps {
  subscriptionV2Id: string;
  /**
   * 'manage' — обычное «Управлять подпиской» (по умолчанию).
   * 'recovery' — «Обновить карту для оплаты» (для past_due / проблема с оплатой).
   */
  mode?: "manage" | "recovery";
}

export function StripePortalButton({ subscriptionV2Id, mode = "manage" }: StripePortalButtonProps) {
  const [isStripe, setIsStripe] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("provider_subscriptions")
        .select("provider")
        .eq("subscription_v2_id", subscriptionV2Id);
      if (cancelled) return;
      if (error) { setIsStripe(false); return; }
      const has = (data ?? []).some((r: any) => r.provider === "stripe");
      setIsStripe(has);
    })();
    return () => { cancelled = true; };
  }, [subscriptionV2Id]);

  if (isStripe !== true) return null;

  const handleOpen = async () => {
    setLoading(true);
    try {
      const returnUrl = `${window.location.origin}/purchases?sub=${encodeURIComponent(subscriptionV2Id)}`;
      const { data, error } = await supabase.functions.invoke(
        "stripe-create-customer-portal-session",
        { body: { subscription_v2_id: subscriptionV2Id, return_url: returnUrl } },
      );
      if (error) {
        toast.error(normalizeEdgeFunctionError(error));
        return;
      }
      const url = (data as any)?.url as string | undefined;
      if (!url) {
        toast.error("Не удалось открыть управление подпиской");
        return;
      }
      window.location.href = url;
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setLoading(false);
    }
  };

  const isRecovery = mode === "recovery";
  const Icon = loading ? Loader2 : isRecovery ? CreditCard : ExternalLink;
  const label = isRecovery ? "Обновить карту для оплаты" : "Управлять подпиской";

  return (
    <Button
      variant={isRecovery ? "default" : "outline"}
      className="w-full gap-2"
      onClick={handleOpen}
      disabled={loading}
    >
      <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {label}
    </Button>
  );
}
