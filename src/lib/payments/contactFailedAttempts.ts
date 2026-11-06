/** Read-only display records, never payments or inputs to a charging action. */
export interface ContactFailedAttempt {
  id: string;
  provider_payment_id: string;
  amount: number;
  currency: string;
  attempted_at: string;
}

interface CanonicalPayment {
  id: string;
  provider_payment_id: string | null;
  paid_at: string | null;
}

export function mergeContactFailedAttempts<T extends CanonicalPayment>(
  payments: readonly T[], attempts: readonly ContactFailedAttempt[],
) {
  const seen = new Set(payments.map(p => p.provider_payment_id).filter(Boolean));
  const displayAttempts = attempts.filter(a => {
    if (!a.id || !a.provider_payment_id || seen.has(a.provider_payment_id)
      || !Number.isFinite(a.amount) || a.amount < 0
      || !/^[A-Z]{3}$/.test(a.currency)
      || !Number.isFinite(Date.parse(a.attempted_at))) return false;
    seen.add(a.provider_payment_id);
    return true;
  }).map(a => ({
    id: `attempt:${a.id}`, provider_payment_id: a.provider_payment_id,
    amount: a.amount, currency: a.currency, paid_at: a.attempted_at,
    status: 'failed' as const, transaction_type: 'payment',
    card_last4: null, card_brand: null, order_id: null,
    is_attempt: true as const,
  }));
  const time = (value: string | null) => {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...payments, ...displayAttempts].sort((a, b) => time(b.paid_at) - time(a.paid_at));
}
