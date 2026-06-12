// ============================================================================
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A
// _shared/stripe/card-extract.ts
//
// Pure sanitizer. NO Stripe API calls, NO DB writes.
//
// Принимает raw Stripe Charge / PaymentMethod / PaymentIntent.latest_charge.
// Возвращает sanitized snapshot канонической формы + плоские DB-поля.
//
// Канонический shape (совместим с существующими readers — pickCard ниже):
//   src/utils/extractStripeCardFromMeta.ts (UI)
//   supabase/functions/_shared/document-resolver-v2/payment-channel.ts (backend)
//
// {
//   "payment_method_details": {
//     "type": "card",
//     "card": {
//       "brand": "visa",
//       "last4": "4242",
//       "wallet": { "type": "apple_pay" } | null,
//       "funding": "credit" | null,
//       "country": "PL" | null
//     }
//   },
//   "card_brand": "visa",
//   "card_last4": "4242",
//   "card_holder": "Ivan Petrov" | null,
//   "payment_method_id": "pm_xxx" | null,
//   "charge_id": "ch_xxx" | null
// }
//
// PCI denylist (NEVER persisted to DB / audit / snapshot output):
//   number, pan, cvc, cvv, exp_month, exp_year, fingerprint
//
// Контракт денилист-скана:
//   - raw input МОЖЕТ содержать любые Stripe-поля. Sanitizer их игнорирует.
//   - post-condition scan проверяет ТОЛЬКО sanitized output.
//   - если запрещённый ключ нашёлся в output → throw 'pci_violation'.
// ============================================================================

export type StripeWallet = 'apple_pay' | 'google_pay' | 'samsung_pay' | null;

export interface SanitizedCardSnapshot {
  type: 'card';
  card: {
    brand: string | null;
    last4: string | null;
    wallet: { type: StripeWallet } | null;
    funding: string | null;
    country: string | null;
  };
}

export interface CardExtractResult {
  hasAnyData: boolean;
  snapshot: SanitizedCardSnapshot | null;
  card_brand: string | null;
  card_last4: string | null;
  card_holder: string | null;     // НЕ попадает в snapshot/audit, только в DB-колонку
  payment_method_id: string | null;
  charge_id: string | null;
}

const PCI_DENYLIST = new Set([
  'number',
  'pan',
  'cvc',
  'cvv',
  'exp_month',
  'exp_year',
  'fingerprint',
]);

function normalizeWallet(v: unknown): StripeWallet {
  if (!v || typeof v !== 'string') return null;
  const s = v.toLowerCase();
  if (s.includes('apple')) return 'apple_pay';
  if (s.includes('google')) return 'google_pay';
  if (s.includes('samsung')) return 'samsung_pay';
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Post-condition: scan ANY JSON object/array deeply for PCI denylist keys.
 * Throws `pci_violation` if a forbidden key is found in OUTPUT payload.
 *
 * Note: this is NOT called on raw Stripe input. It is called only on objects
 * the writer is about to persist to DB or audit.
 */
export function assertNoPciFields(payload: unknown, contextLabel: string): void {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (PCI_DENYLIST.has(key.toLowerCase())) {
        throw new Error(`pci_violation:${contextLabel}:${key}`);
      }
      if (val && typeof val === 'object') stack.push(val);
    }
  }
}

/**
 * Extract sanitized card data from a Stripe Charge-like object.
 *
 * Accepts:
 *   - Stripe Charge (with .payment_method_details.card, .billing_details.name,
 *     .payment_method, .id)
 *   - Stripe PaymentIntent.latest_charge (same shape)
 *
 * Raw input may contain ANY Stripe fields including exp_month/exp_year/
 * fingerprint — they are NOT in the whitelist and silently dropped.
 *
 * Throws 'pci_violation' ONLY if a denylist key sneaks into the output
 * (defensive post-condition; should be impossible given the explicit whitelist).
 */
export function extractCardFromCharge(charge: unknown): CardExtractResult {
  const empty: CardExtractResult = {
    hasAnyData: false,
    snapshot: null,
    card_brand: null,
    card_last4: null,
    card_holder: null,
    payment_method_id: null,
    charge_id: null,
  };

  if (!charge || typeof charge !== 'object') return empty;
  const c = charge as Record<string, any>;

  const pmd = (c.payment_method_details && typeof c.payment_method_details === 'object')
    ? c.payment_method_details as Record<string, any>
    : null;
  const card = pmd?.card && typeof pmd.card === 'object'
    ? pmd.card as Record<string, any>
    : null;
  const billing = (c.billing_details && typeof c.billing_details === 'object')
    ? c.billing_details as Record<string, any>
    : null;

  const brand = strOrNull(card?.brand) ?? strOrNull(card?.display_brand);
  const last4 = strOrNull(card?.last4) ?? strOrNull(card?.last_four);
  const wallet = normalizeWallet(card?.wallet?.type);
  const funding = strOrNull(card?.funding);
  const country = strOrNull(card?.country);
  const holder = strOrNull(billing?.name);
  const paymentMethodId = strOrNull(c.payment_method);
  const chargeId = strOrNull(c.id);

  // Build snapshot only if we have any card-level info (brand/last4/wallet/funding/country).
  let snapshot: SanitizedCardSnapshot | null = null;
  if (brand || last4 || wallet || funding || country) {
    snapshot = {
      type: 'card',
      card: {
        brand,
        last4,
        wallet: wallet ? { type: wallet } : null,
        funding,
        country,
      },
    };
    // Defensive post-condition: nothing forbidden in OUTPUT.
    assertNoPciFields(snapshot, 'card_snapshot');
  }

  const hasAnyData = Boolean(snapshot || holder || paymentMethodId || chargeId);

  return {
    hasAnyData,
    snapshot,
    card_brand: brand,
    card_last4: last4,
    card_holder: holder,
    payment_method_id: paymentMethodId,
    charge_id: chargeId,
  };
}
