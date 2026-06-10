// PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — Stage 2A (fix v2)
// Local-DB reader for Stripe subscriptions, mapped to BepaidSubscription-compatible shape.
// NOTE: no FK constraints exist between provider_subscriptions/subscriptions_v2/tariffs/products/orders_v2/profiles,
// so PostgREST resource embedding does NOT work. We fetch flat tables and join in JS.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  try { return new Date(ms).toISOString(); } catch { return ""; }
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

function uniq<T>(arr: (T | null | undefined)[]): T[] {
  return Array.from(new Set(arr.filter((x): x is T => x != null && (x as any) !== "")));
}

export function useStripeSubscriptionsList() {
  return useQuery({
    queryKey: ["admin-stripe-subscriptions-list", "v2-flat"],
    queryFn: async (): Promise<UnifiedSubscriptionRow[]> => {
      // 1) provider_subscriptions (flat)
      const { data: psRows, error: psErr } = await supabase
        .from("provider_subscriptions")
        .select("id, provider_subscription_id, state, created_at, last_charge_at, meta, subscription_v2_id")
        .eq("provider", "stripe")
        .order("created_at", { ascending: false })
        .limit(500);
      if (psErr) throw psErr;
      const ps = (psRows ?? []) as any[];
      if (ps.length === 0) return [];

      const svIds = uniq(ps.map(r => r.subscription_v2_id));

      // 2) subscriptions_v2 (flat)
      const { data: svRows } = svIds.length
        ? await supabase
            .from("subscriptions_v2")
            .select("id, status, user_id, product_id, tariff_id, order_id, meta")
            .in("id", svIds)
        : { data: [] as any[] };
      const svById: Record<string, any> = {};
      for (const s of (svRows ?? [])) svById[s.id] = s;

      const userIds = uniq((svRows ?? []).map((s: any) => s.user_id));
      const productIds = uniq((svRows ?? []).map((s: any) => s.product_id));
      const tariffIds = uniq((svRows ?? []).map((s: any) => s.tariff_id));
      const orderIds = uniq((svRows ?? []).map((s: any) => s.order_id));

      // 3) profiles / products / tariffs / orders (parallel)
      const [profilesRes, productsRes, tariffsRes, ordersRes] = await Promise.all([
        userIds.length ? supabase.from("profiles").select("user_id, email, full_name").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
        productIds.length ? supabase.from("products").select("id, name").in("id", productIds) : Promise.resolve({ data: [] as any[] }),
        tariffIds.length ? supabase.from("tariffs").select("id, name").in("id", tariffIds) : Promise.resolve({ data: [] as any[] }),
        orderIds.length ? supabase.from("orders_v2").select("id, final_price, currency").in("id", orderIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const profById: Record<string, any> = {};
      for (const p of (profilesRes.data ?? [])) profById[(p as any).user_id] = p;
      const prodById: Record<string, any> = {};
      for (const p of (productsRes.data ?? [])) prodById[(p as any).id] = p;
      const tarById: Record<string, any> = {};
      for (const t of (tariffsRes.data ?? [])) tarById[(t as any).id] = t;
      const ordById: Record<string, any> = {};
      for (const o of (ordersRes.data ?? [])) ordById[(o as any).id] = o;

      return ps.map((r): UnifiedSubscriptionRow => {
        const sv = svById[r.subscription_v2_id] || {};
        const psMeta = (r.meta ?? {}) as any;
        const svMeta = (sv.meta ?? {}) as any;
        const stripeMeta = (svMeta.stripe ?? psMeta.stripe ?? {}) as any;
        const inline = (stripeMeta.inline_price ?? psMeta?.stripe?.inline_price ?? {}) as any;
        const order = ordById[sv.order_id] || {};
        const tariff = tarById[sv.tariff_id] || {};
        const product = prodById[sv.product_id] || {};
        const prof = profById[sv.user_id] || {};

        const subId: string =
          (r.provider_subscription_id && !String(r.provider_subscription_id).startsWith("pending:")
            ? r.provider_subscription_id
            : sv.id) || r.id;

        const amount =
          (typeof order.final_price === "number" ? order.final_price : Number(order.final_price)) ||
          (typeof svMeta.amount === "number" ? svMeta.amount : null) ||
          (typeof inline.amount_major === "number" ? inline.amount_major : null) ||
          (typeof inline.amount_minor === "number" ? Number(inline.amount_minor) / 100 : null) ||
          0;

        const currency = order.currency || svMeta.currency || inline.currency || "USD";

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
