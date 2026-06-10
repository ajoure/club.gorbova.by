// PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — Stage 2E
// Read-only resolver: достаёт payer card (brand/last4/wallet) из Stripe-meta.
// SOT: payments_v2.meta.stripe.* и payments_v2.meta.provider_response.stripe.*.
// Никаких сетевых вызовов в Stripe; никакой записи в БД.

export type StripeWallet = 'apple_pay' | 'google_pay' | 'samsung_pay' | null;

export interface StripeCardExtract {
  brand: string | null;
  last4: string | null;
  wallet: StripeWallet;
}

function normalizeWallet(v: any): StripeWallet {
  if (!v || typeof v !== 'string') return null;
  const s = v.toLowerCase();
  if (s.includes('apple')) return 'apple_pay';
  if (s.includes('google')) return 'google_pay';
  if (s.includes('samsung')) return 'samsung_pay';
  return null;
}

function pickCard(node: any): { brand: string | null; last4: string | null; wallet: StripeWallet } | null {
  if (!node || typeof node !== 'object') return null;
  // typical Stripe shape: payment_method_details.card.{brand,last4,wallet:{type}}
  const card = node.card ?? node;
  const brand =
    (typeof card?.brand === 'string' && card.brand) ||
    (typeof card?.display_brand === 'string' && card.display_brand) ||
    null;
  const last4 =
    (typeof card?.last4 === 'string' && card.last4) ||
    (typeof card?.last_four === 'string' && card.last_four) ||
    null;
  const wallet = normalizeWallet(card?.wallet?.type);
  if (!brand && !last4 && !wallet) return null;
  return { brand, last4, wallet };
}

export function extractStripeCardFromMeta(meta: any): StripeCardExtract {
  if (!meta || typeof meta !== 'object') {
    return { brand: null, last4: null, wallet: null };
  }
  const sm = (meta.stripe || {}) as any;
  const pr = (meta.provider_response?.stripe || {}) as any;

  const candidates: any[] = [
    sm?.payment_method_details,
    sm?.charge?.payment_method_details,
    sm?.payment_method?.card ? { card: sm.payment_method.card } : null,
    sm?.card,
    pr?.payment_method_details,
    pr?.charge?.payment_method_details,
    pr?.payment_method?.card ? { card: pr.payment_method.card } : null,
    pr?.card,
  ];

  for (const c of candidates) {
    const picked = pickCard(c);
    if (picked) return picked;
  }
  return { brand: null, last4: null, wallet: null };
}
