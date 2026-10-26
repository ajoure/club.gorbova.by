// Guard the deployed entry point without changing unrelated shared packages.
import { reconcileExactQueuePayment as canonicalRecovery } from '../_shared/bepaid-canonical-recovery.ts';
import { inspectHistoricalReceipt } from '../bepaid-webhook/historical-receipt-guard.ts';

export async function reconcileExactQueuePayment(
  db: Parameters<typeof canonicalRecovery>[0], options: Parameters<typeof canonicalRecovery>[1],
) {
  // Match canonical argument/CAS requirements before acknowledging a replay.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(options.queueItemId)) throw new Error('recovery_invalid_queue_id');
  if (options.operatorUserId && (!uuid.test(options.operatorUserId) || !options.paidContinuation)) {
    throw new Error('recovery_invalid_manual_operator');
  }
  if (options.paidContinuation && (!options.expectedUpdatedAt || !options.providerSubscriptionId || options.recordPreflightFailure)) {
    throw new Error('recovery_continuation_exact_manual_required');
  }
  if (options.recordPreflightFailure && !options.expectedUpdatedAt) throw new Error('recovery_preflight_snapshot_required');
  const read = await db.from('payment_reconcile_queue').select('*').eq('id', options.queueItemId).maybeSingle();
  if (read.error) throw new Error('recovery_payment_reconcile_queue_failed');
  const item = read.data;
  if (!item) throw new Error('recovery_queue_missing');
  if (options.expectedUpdatedAt && options.expectedUpdatedAt !== item.updated_at) throw new Error('recovery_queue_snapshot_changed');
  const historical = await inspectHistoricalReceipt(db, item.bepaid_uid);
  if (historical.kind === 'hold') throw new Error(historical.reason);
  if (historical.kind === 'preserved') return { success: true, historical_receipt_preserved: true,
    no_writes: true, fulfillment_verified: false, order_id: historical.orderId,
    results: { orders_reconciled: 0, already_materialized: 1 } };
  return canonicalRecovery(db, options);
}
