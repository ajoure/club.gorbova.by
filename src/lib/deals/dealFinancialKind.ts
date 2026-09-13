/** Presentation only: never changes fulfillment/payment statuses in the ledger. */
export interface DealFinancialEvidence {
  status?: string | null;
  paid_amount?: number | string | null;
  final_price?: number | string | null;
  reconcile_source?: string | null;
  provider?: string | null;
  purchase_snapshot?: unknown;
  meta?: unknown;
  payments_v2?: readonly { transaction_type?: string | null; is_deleted?: boolean | null; status?: string | null; amount?: number | string | null; refunded_amount?: number | string | null }[] | null;
}

const settled = new Set(['paid', 'succeeded', 'refunded', 'partially_refunded']);
const freeSources = new Set(['admin_grant', 'admin_deal_only', 'bulk_grant']);
const historicalSources = new Set(['owner_confirmed_historical', 'getcourse_historical', 'getcourse', 'csv_active_import', 'historical_import']);

function metadata(deal: DealFinancialEvidence): Record<string, unknown> {
  return deal.meta && typeof deal.meta === 'object' && !Array.isArray(deal.meta)
    ? deal.meta as Record<string, unknown> : {};
}

export function hasSettledDealMoney(deal: DealFinancialEvidence): boolean {
  return Number(deal.paid_amount) > 0 || (deal.payments_v2 ?? []).some(payment =>
    payment.is_deleted !== true && !['void', 'Отмена', 'authorization', 'tokenization'].includes(payment.transaction_type ?? '') &&
    settled.has(payment.status ?? '') && (Math.abs(Number(payment.amount)) > 0 || Number(payment.refunded_amount) > 0),
  );
}

export function isFreeDeal(deal: DealFinancialEvidence): boolean {
  // Unknown historical amounts are not evidence of a gift. Money overrides a
  // stale grant marker if an administrator later attaches a genuine payment.
  if (hasSettledDealMoney(deal) || historicalSources.has(String(deal.reconcile_source ?? ''))) return false;
  const meta = metadata(deal);
  return meta.financial_kind === 'free_grant' || freeSources.has(String(meta.source ?? ''));
}

export function isContactMoneyDeal(deal: DealFinancialEvidence): boolean {
  if (isFreeDeal(deal)) return false;
  if (hasSettledDealMoney(deal)) return true;
  const meta = metadata(deal);
  // Settled legacy orders are the imported purchase record. Missing ledger
  // rows must not erase purchases, including unknown historical amounts.
  return ['paid', 'partial', 'refunded'].includes(deal.status ?? '') &&
    (Number(deal.final_price) > 0 || historicalSources.has(String(deal.reconcile_source ?? '')) ||
      historicalSources.has(String(deal.provider ?? '')) || historicalSources.has(String(meta.source ?? '')));
}

export function dealStatusLabel(deal: DealFinancialEvidence, fallback: string): string {
  return isFreeDeal(deal) ? 'Бесплатно' : fallback;
}
