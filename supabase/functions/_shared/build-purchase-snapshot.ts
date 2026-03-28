/**
 * Build an immutable purchase_snapshot for orders_v2.
 * 
 * This is the single source of truth for "what was promised at the time of order creation".
 * Once written, it must never be modified.
 * 
 * Minimum contract fields (D45):
 * - product_id, product_public_id, product_name, product_code
 * - tariff_id, tariff_public_id, tariff_name, tariff_code
 * - offer_id
 * - price, currency
 * - access_days, planned_access_start_at, planned_access_end_at
 * - is_trial, trial_days
 * - reconcile_source
 * - snapshot_created_at
 * 
 * Extra fields may be added per write-path (e.g. bepaid_uid, gc_deal_id).
 */

export interface PurchaseSnapshotInput {
  // Product
  product_id?: string | null;
  product_public_id?: string | null;
  product_name?: string | null;
  product_code?: string | null;

  // Tariff
  tariff_id?: string | null;
  tariff_public_id?: string | null;
  tariff_name?: string | null;
  tariff_code?: string | null;

  // Offer
  offer_id?: string | null;

  // Pricing
  price?: number | null;
  currency?: string | null;

  // Access plan
  access_days?: number | null;
  planned_access_start_at?: string | null;
  planned_access_end_at?: string | null;

  // Trial
  is_trial?: boolean;
  trial_days?: number | null;

  // Source
  reconcile_source?: string | null;

  // Extra fields per write-path
  extra?: Record<string, unknown>;
}

export interface PurchaseSnapshot {
  product_id: string | null;
  product_public_id: string | null;
  product_name: string | null;
  product_code: string | null;
  tariff_id: string | null;
  tariff_public_id: string | null;
  tariff_name: string | null;
  tariff_code: string | null;
  offer_id: string | null;
  price: number | null;
  currency: string | null;
  access_days: number | null;
  planned_access_start_at: string | null;
  planned_access_end_at: string | null;
  is_trial: boolean;
  trial_days: number | null;
  reconcile_source: string | null;
  snapshot_created_at: string;
  [key: string]: unknown;
}

export function buildPurchaseSnapshot(input: PurchaseSnapshotInput): PurchaseSnapshot {
  const base: PurchaseSnapshot = {
    product_id: input.product_id ?? null,
    product_public_id: input.product_public_id ?? null,
    product_name: input.product_name ?? null,
    product_code: input.product_code ?? null,
    tariff_id: input.tariff_id ?? null,
    tariff_public_id: input.tariff_public_id ?? null,
    tariff_name: input.tariff_name ?? null,
    tariff_code: input.tariff_code ?? null,
    offer_id: input.offer_id ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
    access_days: input.access_days ?? null,
    planned_access_start_at: input.planned_access_start_at ?? null,
    planned_access_end_at: input.planned_access_end_at ?? null,
    is_trial: input.is_trial ?? false,
    trial_days: input.trial_days ?? null,
    reconcile_source: input.reconcile_source ?? null,
    snapshot_created_at: new Date().toISOString(),
  };

  // Merge extra fields (write-path specific)
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (!(key in base)) {
        base[key] = value;
      }
    }
  }

  return base;
}
