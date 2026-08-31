/** Existing debt only. Never derive a repayment from today's tariff price. */
export class RepaymentPlanError extends Error {
  constructor(public code: string) { super(code); }
}

export function moneyMinor(value: unknown): number {
  if (!['number', 'string'].includes(typeof value) || value === '') throw new RepaymentPlanError('invalid_money');
  const n = Number(value);
  const minor = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(minor)
      || Math.abs(n * 100 - minor) > 0.000001) throw new RepaymentPlanError('invalid_money');
  return minor;
}

export type RepaymentPayment = {
  id: string; order_id: string | null; user_id: string | null; currency: string;
  provider: string | null; provider_payment_id: string | null; status: string;
  amount: number | string; refunded_amount?: number | string | null;
  is_deleted?: boolean; transaction_type?: string | null;
};

/** Fail closed on disputed duplicates, refunds or foreign money; no inferred payments. */
export function repaymentBalance(input: {
  orderId: string; userId: string; currency: string; total: unknown; payments: RepaymentPayment[];
}) {
  const totalMinor = moneyMinor(input.total);
  if (totalMinor <= 0) throw new RepaymentPlanError('invalid_installment_total');
  const unique = new Map<string, number>();
  for (const p of input.payments) {
    if (p.is_deleted || !['succeeded', 'refunded', 'partially_refunded'].includes(p.status)) continue;
    if (p.order_id !== input.orderId || p.user_id !== input.userId || p.currency !== input.currency) {
      throw new RepaymentPlanError('payment_identity_mismatch');
    }
    if (p.transaction_type && !['payment', 'capture'].includes(p.transaction_type)) {
      throw new RepaymentPlanError('payment_type_requires_review');
    }
    // A refund changes the agreement; never silently re-charge refunded money.
    if (p.status !== 'succeeded' || moneyMinor(p.refunded_amount ?? 0) !== 0) {
      throw new RepaymentPlanError('refunded_installment_requires_review');
    }
    const amount = moneyMinor(p.amount);
    if (amount <= 0) throw new RepaymentPlanError('invalid_payment_amount');
    const key = p.provider_payment_id ? `${p.provider}:${p.provider_payment_id}` : `row:${p.id}`;
    if (unique.has(key) && unique.get(key) !== amount) throw new RepaymentPlanError('conflicting_payment_duplicate');
    unique.set(key, amount);
  }
  const paidMinor = [...unique.values()].reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(paidMinor) || paidMinor > totalMinor) throw new RepaymentPlanError('installment_overpaid');
  if (paidMinor === 0) throw new RepaymentPlanError('installment_has_no_payment');
  return { totalMinor, paidMinor, remainingMinor: totalMinor - paidMinor, paidCount: unique.size };
}

/** Split every kopeck, keeping the original debt unchanged (unlike a new-sale quote). */
export function splitRemainingDebt(remainingMinor: number, count: number): number[] {
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor <= 0) throw new RepaymentPlanError('no_remaining_debt');
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new RepaymentPlanError('invalid_repayment_count');
  const regular = Math.floor(remainingMinor / count);
  if (regular < 100) throw new RepaymentPlanError('repayment_below_minimum');
  return Array.from({ length: count }, (_, index) => regular + (index < remainingMinor % count ? 1 : 0));
}

export function isInstallmentIntent(meta: Record<string, unknown> | null | undefined): boolean {
  const block = meta?.installment && typeof meta.installment === 'object'
    ? meta.installment as Record<string, unknown>
    : {};
  return block.model === 'bepaid_finite_subscription' || meta?.model === 'bepaid_finite_subscription'
    || block.as_finite_subscription === true || meta?.payment_method === 'internal_installment'
    || Number(meta?.installment_count ?? block.billing_cycles ?? 0) >= 2;
}
