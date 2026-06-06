import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaymentIssueStatus } from "./usePaymentIssuesCounters";

/**
 * Phase 3.6-B (UI-only, read-only).
 * Список подписок Stripe с непустым meta.stripe.dunning_status.
 * Только SELECT, никаких мутаций.
 */
export interface PaymentIssueRow {
  id: string;
  user_id: string | null;
  product_id: string | null;
  tariff_id: string | null;
  status: string | null;
  cancel_at: string | null;
  cancel_reason: string | null;
  updated_at: string | null;
  currency: string | null;
  dunning_status: PaymentIssueStatus;
  next_payment_attempt: string | null;
  last_failure_reason: string | null;
  amount: number | null;
  attempt_count: number | null;
  client_name: string | null;
  client_email: string | null;
  product_name: string | null;
  tariff_title: string | null;
}

export type PaymentIssuesFilter = "all" | PaymentIssueStatus;

export function usePaymentIssuesSubscriptions(filter: PaymentIssuesFilter = "all") {
  return useQuery<PaymentIssueRow[]>({
    queryKey: ["payment-issues-subscriptions", filter],
    queryFn: async () => {
      let q = supabase
        .from("subscriptions_v2")
        .select(
          "id, user_id, product_id, tariff_id, status, cancel_at, cancel_reason, updated_at, meta",
        )
        .eq("provider", "stripe")
        .not("meta->stripe->>dunning_status", "is", null)
        .order("updated_at", { ascending: false })
        .limit(500);

      if (filter !== "all") {
        q = q.eq("meta->stripe->>dunning_status", filter);
      }

      const { data: subs, error } = await q;
      if (error || !subs) return [];

      const subsArr = subs as any[];
      const userIds = Array.from(new Set(subsArr.map((s) => s.user_id).filter(Boolean))) as string[];
      const productIds = Array.from(new Set(subsArr.map((s) => s.product_id).filter(Boolean))) as string[];
      const tariffIds = Array.from(new Set(subsArr.map((s) => s.tariff_id).filter(Boolean))) as string[];

      const [profilesRes, productsRes, tariffsRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("user_id, first_name, last_name, email").in("user_id", userIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        productIds.length
          ? supabase.from("products_v2").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        tariffIds.length
          ? supabase.from("tariffs").select("id, title").in("id", tariffIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      const profileMap = new Map<string, any>();
      ((profilesRes.data as any[]) || []).forEach((p) => profileMap.set(p.user_id, p));
      const productMap = new Map<string, any>();
      ((productsRes.data as any[]) || []).forEach((p) => productMap.set(p.id, p));
      const tariffMap = new Map<string, any>();
      ((tariffsRes.data as any[]) || []).forEach((t) => tariffMap.set(t.id, t));

      return subsArr.map((s): PaymentIssueRow => {
        const meta = (s.meta ?? {}) as Record<string, any>;
        const stripeMeta = (meta.stripe ?? {}) as Record<string, any>;
        const profile = s.user_id ? profileMap.get(s.user_id) : null;
        const product = s.product_id ? productMap.get(s.product_id) : null;
        const tariff = s.tariff_id ? tariffMap.get(s.tariff_id) : null;

        const clientName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null
          : null;

        return {
          id: s.id,
          user_id: s.user_id,
          product_id: s.product_id,
          tariff_id: s.tariff_id,
          status: s.status,
          cancel_at: s.cancel_at,
          cancel_reason: s.cancel_reason,
          updated_at: s.updated_at,
          currency: stripeMeta.currency ?? null,
          dunning_status: stripeMeta.dunning_status as PaymentIssueStatus,
          next_payment_attempt: stripeMeta.next_payment_attempt ?? null,
          last_failure_reason: stripeMeta.last_failure_reason ?? null,
          amount: typeof stripeMeta.amount === "number" ? stripeMeta.amount : null,
          attempt_count: typeof stripeMeta.attempt_count === "number" ? stripeMeta.attempt_count : null,
          client_name: clientName,
          client_email: profile?.email ?? null,
          product_name: product?.name ?? null,
          tariff_title: tariff?.title ?? null,
        };
      });
    },
    staleTime: 60_000,
  });
}
