// Phase 3.3 — Кнопка «Управлять в Stripe» (Customer Portal).
// Видна только если у подписки provider='stripe'. Открывает Stripe Hosted Portal.

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface StripePortalButtonProps {
  subscriptionV2Id: string;
}

export function StripePortalButton({ subscriptionV2Id }: StripePortalButtonProps) {
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
        toast.error("Не удалось получить ссылку на Stripe Portal");
        return;
      }
      window.location.href = url;
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      className="w-full gap-2"
      onClick={handleOpen}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
      Управлять в Stripe
    </Button>
  );
}
