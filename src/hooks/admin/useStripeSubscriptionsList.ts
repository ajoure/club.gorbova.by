// PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — Stage 2A
// Local-DB reader for Stripe subscriptions, mapped to BepaidSubscription-compatible shape.
// SOT: provider_subscriptions + subscriptions_v2 + tariffs + products + orders_v2 + profiles.
// Не вызывает Stripe API. Не пишет в БД. Только read.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Совместимая со строками bePaid форма + provider маркер.
// Поля card_*, last_payment_at, next_billing_at заполняются по мере наличия данных.
export interface UnifiedSubscriptionRow {
  provider: "bepaid" | "stripe";
  id: string;
  status: string;
  plan_title: string;
  plan_amount: number;
  plan_currency: string;
  customer_email: string;
  customer_name: string;
  card_last4: string;
  card_brand: string;
  created_at: string;
  next_billing_at: string;
  last_payment_at?: string;
  linked_subscription_id: string | null;
  linked_user_id: string | null;
  linked_profile_name: string | null;
  is_linked_full: boolean;
}

function unixToIso(v: any): string {
  if (v == null) return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  // unix seconds → ms
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

function normalizeStripeStatus(s: string | null | undefined): string {
  switch (s) {
    case "active":
    case "trialing":
    case "past_due":
    case "pending":
      return s;
    case "canceled":
    case "cancelled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "pending";
    case "unpaid":
      return "past_due";
    default:
      return s || "unknown";
  }
}

export function useStripeSubscriptionsList() {
  return useQuery({
    queryKey: ["admin-stripe-subscriptions-list", "v1"],
    queryFn: async (): Promise<UnifiedSubscriptionRow[]> => {
      // 1) provider_subscriptions + nested subscriptions_v2/tariffs/products/orders_v2
      const { data: psRows, error: psErr } = await supabase
        .from("provider_subscriptions")
        .select(
          `id, provider_subscription_id, state, created_at, last_charge_at, meta,
           subscription_v2_id,
           subscriptions_v2 (
             id, status, user_id, product_id, tariff_id, order_id, meta,
             tariffs ( name ),
             products ( name ),
             orders_v2 ( final_price, currency )
           )`
        )
        .eq("provider", "stripe")
        .order("created_at", { ascending: false })
        .limit(500);

      if (psErr) throw psErr;
      const rows = (psRows ?? []) as any[];
      if (rows.length === 0) return [];

      // 2) profiles by user_id IN (...)
      const userIds = Array.from(
        new Set(
          rows
            .map((r) => r.subscriptions_v2?.user_id)
            .filter((x) => typeof x === "string" && x.length > 0)
        )
      );
      let profilesByUserId: Record<string, { email: string | null; full_name: string | null }> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", userIds);
        for (const p of profs ?? []) {
          profilesByUserId[(p as any).user_id] = {
            email: (p as any).email ?? null,
            full_name: (p as any).full_name ?? null,
          };
        }
      }

      // 3) Map → UnifiedSubscriptionRow
      return rows.map((r): UnifiedSubscriptionRow => {
        const sv = r.subscriptions_v2 ?? {};
        const psMeta = (r.meta ?? {}) as any;
        const svMeta = (sv.meta ?? {}) as any;
        const stripeMeta = (svMeta.stripe ?? psMeta.stripe ?? {}) as any;
        const inline = (stripeMeta.inline_price ?? psMeta?.stripe?.inline_price ?? {}) as any;
        const order = (sv.orders_v2 ?? {}) as any;
        const tariff = (sv.tariffs ?? {}) as any;
        const product = (sv.products ?? {}) as any;
        const prof = profilesByUserId[sv.user_id] || { email: null, full_name: null };

        const subId: string =
          (r.provider_subscription_id && !String(r.provider_subscription_id).startsWith("pending:")
            ? r.provider_subscription_id
            : sv.id) || r.id;

        const amount =
          (typeof order.final_price === "number" ? order.final_price : null) ??
          (typeof svMeta.amount === "number" ? svMeta.amount : null) ??
          (typeof inline.amount_major === "number" ? inline.amount_major : null) ??
          (typeof inline.amount_minor === "number" ? Number(inline.amount_minor) / 100 : null) ??
          0;

        const currency =
          order.currency || svMeta.currency || inline.currency || "USD";

        const nextBillingIso =
          unixToIso(stripeMeta.current_period_end) ||
          unixToIso(psMeta?.stripe?.current_period_end) ||
          "";

        return {
          provider: "stripe",
          id: subId,
          status: normalizeStripeStatus(sv.status ?? r.state),
          plan_title: tariff.name || product.name || "—",
          plan_amount: Number(amount) || 0,
          plan_currency: String(currency || "").toUpperCase(),
          customer_email: prof.email || "",
          customer_name: prof.full_name || "",
          card_last4: "",
          card_brand: "",
          created_at: r.created_at,
          next_billing_at: nextBillingIso,
          last_payment_at: r.last_charge_at || "",
          linked_subscription_id: sv.id || null,
          linked_user_id: sv.user_id || null,
          linked_profile_name: prof.full_name || null,
          is_linked_full: !!sv.user_id,
        };
      });
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}
