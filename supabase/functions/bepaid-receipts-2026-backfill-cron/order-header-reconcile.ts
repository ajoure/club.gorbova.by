export interface SucceededPaymentEvidence {
  paymentId: string;
  amount: number;
  providerPaymentId: string;
  bepaidSubscriptionId: string;
}

export function buildOrderHeaderReconcilePatch(
  evidence: SucceededPaymentEvidence,
  reconciledAt: string,
) {
  return {
    status: "paid",
    paid_amount: evidence.amount,
    provider: "bepaid",
    provider_payment_id: evidence.providerPaymentId,
    bepaid_subscription_id: evidence.bepaidSubscriptionId,
    reconcile_meta: {
      paid_at_finalized_via: "receipt_backfill_reconcile",
      reconcile_reason: "subscription_phantom_uid_skipped_no_provider_event",
      payment_v2_id: evidence.paymentId,
      reconciled_at: reconciledAt,
    },
  };
}
