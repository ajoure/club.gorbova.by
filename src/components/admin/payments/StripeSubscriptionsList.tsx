// PATCH: лёгкий read-only список Stripe-подписок для единой вкладки «Подписки».
// SOT: provider_subscriptions JOIN subscriptions_v2.
// НЕ выполняет provider-actions (cancel/sync) — отдельный PATCH.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

interface StripeSubRow {
  ps_id: string;
  provider_subscription_id: string | null;
  state: string | null;
  created_at: string;
  last_charge_at: string | null;
  subv2_id: string;
  subv2_status: string | null;
  user_id: string | null;
  product_id: string | null;
  tariff_id: string | null;
  order_id: string | null;
  amount: number | null;
  currency: string | null;
}

export function StripeSubscriptionsList() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stripe-subscriptions-list"],
    queryFn: async (): Promise<StripeSubRow[]> => {
      const { data, error } = await supabase
        .from("provider_subscriptions")
        .select(`
          id, provider_subscription_id, state, created_at, last_charge_at,
          subscription_v2_id,
          subscriptions_v2!inner ( id, status, user_id, product_id, tariff_id, order_id )
        `)
        .eq("provider", "stripe")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return rows.map((r) => ({
        ps_id: r.id,
        provider_subscription_id: r.provider_subscription_id,
        state: r.state,
        created_at: r.created_at,
        last_charge_at: r.last_charge_at,
        subv2_id: r.subscriptions_v2?.id,
        subv2_status: r.subscriptions_v2?.status,
        user_id: r.subscriptions_v2?.user_id,
        product_id: r.subscriptions_v2?.product_id,
        tariff_id: r.subscriptions_v2?.tariff_id,
        order_id: r.subscriptions_v2?.order_id,
        amount: null,
        currency: null,
      })) as StripeSubRow[];
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
        <Loader2 className="h-3 w-3 animate-spin" /> Загрузка Stripe-подписок…
      </div>
    );
  }
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-card/20 backdrop-blur-md p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Badge variant="outline" className="bg-violet-500/10 text-violet-700 border-violet-500/30">
          Stripe
        </Badge>
        <span className="text-muted-foreground">
          Подписки ({rows.length})
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border/30">
              <th className="text-left py-2 pr-3">Провайдер</th>
              <th className="text-left py-2 pr-3">Stripe ID</th>
              <th className="text-left py-2 pr-3">Состояние</th>
              <th className="text-left py-2 pr-3">Статус (subv2)</th>
              <th className="text-left py-2 pr-3">Создана</th>
              <th className="text-left py-2 pr-3">Последняя оплата</th>
              <th className="text-left py-2 pr-3">Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ps_id} className="border-b border-border/20 hover:bg-muted/30">
                <td className="py-1.5 pr-3">
                  <Badge variant="outline" className="bg-violet-500/10 text-violet-700 border-violet-500/30 text-[10px]">
                    Stripe
                  </Badge>
                </td>
                <td className="py-1.5 pr-3 font-mono truncate max-w-[200px]" title={r.provider_subscription_id ?? ""}>
                  {r.provider_subscription_id ?? "—"}
                </td>
                <td className="py-1.5 pr-3">{r.state ?? "—"}</td>
                <td className="py-1.5 pr-3">{r.subv2_status ?? "—"}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">
                  {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground">
                  {r.last_charge_at ? format(new Date(r.last_charge_at), "yyyy-MM-dd HH:mm") : "—"}
                </td>
                <td className="py-1.5 pr-3 font-mono text-muted-foreground truncate max-w-[160px]" title={r.order_id ?? ""}>
                  {r.order_id ? r.order_id.slice(0, 8) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
