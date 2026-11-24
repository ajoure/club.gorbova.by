// The receipt must commit before the canonical writer derives its access window.
// Retry ownership stays with payment_reconcile_queue / payments-reconcile.
export type SubscriptionGrant = {
  outcome: 'ok' | 'skip' | 'error';
  status: number;
  result: Record<string, unknown> | null;
};
type PaymentReceipt = { id: string | null; action: 'created' | 'updated' | 'error' };

export function classifySubscriptionGrant(ok: boolean, status: number, result: SubscriptionGrant['result']): SubscriptionGrant {
  let outcome: SubscriptionGrant['outcome'] = 'ok';
  if (!ok || !result) outcome = 'error';
  else if (result.skipped === true || result.status === 'skipped' ||
    String(result.reason || '').startsWith('skip_') || ['sbs_mismatch', 'manual_review'].includes(String(result.reason || ''))) outcome = 'skip';
  else if (result.success === false) outcome = 'error';
  return { outcome, status, result };
}

export async function grantForPersistedPayment(
  receipt: PaymentReceipt | Promise<PaymentReceipt>,
  grant: () => Promise<SubscriptionGrant>,
): Promise<SubscriptionGrant> {
  try {
    const payment = await receipt;
    // A successful insert without a readable ID is not durable proof either.
    if (payment.action === 'error' || !payment.id) {
      return { outcome: 'error', status: 0, result: { error: 'payment_fact_not_persisted' } };
    }
    return await grant();
  } catch {
    // No fallback writer and no immediate blind retry after an uncertain call.
    return { outcome: 'error', status: 0, result: { error: 'subscription_grant_transport_failed' } };
  }
}
