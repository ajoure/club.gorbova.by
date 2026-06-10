// PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — Stage 2D
// Canonical resolver for "next charge" date on a unified subscription row
// (provider_subscriptions JOIN subscriptions_v2). Priority chain:
//   1) subscriptions_v2.meta.stripe.current_period_end (unix sec → ISO)
//   2) provider_subscriptions.meta.stripe.current_period_end (unix sec → ISO)
//   3) subscriptions_v2.meta.current_period_end (flat fallback, rarely set)
//   4) provider_subscriptions.next_charge_at (bePaid resolver writes here)
//   5) subscriptions_v2.next_charge_at
//   → otherwise null
//
// Контракт: НИКОГДА не подменять next_charge_at через access_end_at.
// access_end_at рендерится отдельной строкой «Доступ до …».

function unixSecToIso(v: any): string | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function asIso(v: any): string | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ProviderSubLike {
  next_charge_at?: string | null;
  meta?: Record<string, any> | null;
  subscriptions_v2?: {
    next_charge_at?: string | null;
    meta?: Record<string, any> | null;
  } | null;
}

export interface NextChargeResolution {
  iso: string | null;
  source:
    | "subv2_meta_stripe_cpe"
    | "ps_meta_stripe_cpe"
    | "subv2_meta_cpe"
    | "ps_next_charge_at"
    | "subv2_next_charge_at"
    | "none";
}

export function resolveStripeNextChargeAt(sub: ProviderSubLike | null | undefined): NextChargeResolution {
  if (!sub) return { iso: null, source: "none" };
  const subv2Meta = (sub.subscriptions_v2?.meta ?? null) as any;
  const psMeta = (sub.meta ?? null) as any;

  const fromSubv2Stripe = unixSecToIso(subv2Meta?.stripe?.current_period_end);
  if (fromSubv2Stripe) return { iso: fromSubv2Stripe, source: "subv2_meta_stripe_cpe" };

  const fromPsStripe = unixSecToIso(psMeta?.stripe?.current_period_end);
  if (fromPsStripe) return { iso: fromPsStripe, source: "ps_meta_stripe_cpe" };

  const fromSubv2Flat = unixSecToIso(subv2Meta?.current_period_end);
  if (fromSubv2Flat) return { iso: fromSubv2Flat, source: "subv2_meta_cpe" };

  const fromPs = asIso(sub.next_charge_at ?? null);
  if (fromPs) return { iso: fromPs, source: "ps_next_charge_at" };

  const fromSubv2 = asIso(sub.subscriptions_v2?.next_charge_at ?? null);
  if (fromSubv2) return { iso: fromSubv2, source: "subv2_next_charge_at" };

  return { iso: null, source: "none" };
}
