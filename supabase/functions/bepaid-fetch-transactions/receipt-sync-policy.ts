// Package-local source; sync mirrors with scripts/payments/sync-historical-receipt-guards.mjs.
// Discovery/import may observe receipts. It must never replace their purchase
// identity or impersonate the canonical payment/access writer.
// deno-lint-ignore-file no-explicit-any
import { hasHistoricalReceiptMarker, inspectHistoricalReceipt } from './historical-receipt-guard.ts';
import { parseBepaidTrackingId } from '../_shared/bepaid-tracking-id.ts';

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SBS = /^sbs_[A-Za-z0-9_-]{1,128}$/;
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const money = (a: unknown, b: unknown) => a != null && b != null &&
  Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b);
export const paidTransaction = (tx: any) =>
  ['successful', 'succeeded', 'paid', 'success'].includes(String(tx?.status).toLowerCase()) &&
  ['payment', 'capture', 'charge', 'sale'].includes(String(tx?.type).toLowerCase());
// Unknown/missing types on a successful positive transaction must also leave
// through the strict recovery gate (which holds them), never a legacy INSERT
// whose default type would fabricate a purchase. Explicit non-purchases retain
// their existing import path.
export const requiresReceiptRecovery = (tx: any) =>
  ['successful', 'succeeded', 'paid', 'success'].includes(String(tx?.status).toLowerCase()) &&
  !['authorization', 'auth', 'refund', 'chargeback', 'void', 'voided'].includes(String(tx?.type).toLowerCase()) &&
  !(Number(tx?.amount) < 0 || tx?.refund || tx?.refund_reason);

export type ReceiptSyncDecision =
  | { kind: 'absent' }
  | { kind: 'existing'; payment: any }
  | { kind: 'preserved'; orderId: string; historical: boolean }
  | { kind: 'hold'; reason: string };

async function checked(query: any): Promise<any> {
  const r = await query;
  if (r.error) throw new Error('receipt_sync_lookup_failed');
  return r.data;
}

/** Pure read policy. Protected receipts are immutable even to a status/meta
 * importer, and lookup failures never mean "missing, insert another payment".
 */
export async function inspectReceiptSync(db: any, uid: string, incoming?: any): Promise<ReceiptSyncDecision> {
  if (!UID.test(uid || '')) return { kind: 'hold', reason: 'receipt_sync_invalid_uid' };
  try {
    const historical = await inspectHistoricalReceipt(db, uid, incoming ? {
      amount: Number.isInteger(incoming.amount) ? incoming.amount / 100 : null,
      currency: incoming.currency, paidAt: incoming.paid_at || incoming.created_at,
      status: incoming.status, type: incoming.type,
    } : undefined);
    if (historical.kind === 'hold') return historical;
    if (historical.kind === 'preserved') return {
      kind: 'preserved', orderId: historical.orderId, historical: true,
    };
    const payment = await checked(db.from('payments_v2').select('*')
      .eq('provider', 'bepaid').eq('provider_payment_id', uid).maybeSingle());
    const canonical = await checked(db.from('orders_v2').select('*')
      .eq('order_number', `REBILL-${uid.slice(0, 12)}`).maybeSingle());
    const linked = payment?.order_id && payment.order_id !== canonical?.id
      ? await checked(db.from('orders_v2').select('*').eq('id', payment.order_id).maybeSingle()) : canonical;
    // Catch partial markers and marker drift between the two read snapshots.
    if ([payment, canonical, linked].some(r => hasHistoricalReceiptMarker(r?.meta))) {
      return { kind: 'hold', reason: 'receipt_sync_marker_changed' };
    }
    const periodOrder = canonical || (String(linked?.order_number || '').startsWith('REBILL-') ||
      linked?.meta?.source === 'bepaid_rebill' ? linked : null);
    if (!periodOrder) return payment ? { kind: 'existing', payment } : { kind: 'absent' };
    if (!payment || payment.order_id !== periodOrder.id || periodOrder.order_number !== `REBILL-${uid.slice(0, 12)}` ||
        (canonical && linked && canonical.id !== linked.id) ||
        periodOrder.provider !== 'bepaid' || periodOrder.provider_payment_id !== uid ||
        periodOrder.meta?.materialized_from_payment_uid !== uid ||
        periodOrder.status !== 'paid' || periodOrder.is_deleted || payment.is_deleted ||
        payment.status !== 'succeeded' || !['payment', 'Платеж'].includes(payment.transaction_type) ||
        Number(payment.refunded_amount || 0) !== 0 || !money(payment.amount, periodOrder.final_price) ||
        !money(periodOrder.paid_amount, periodOrder.final_price) || Number(payment.amount) <= 0 ||
        payment.currency !== periodOrder.currency || !date(payment.paid_at) || !date(periodOrder.deal_date) ||
        Date.parse(payment.paid_at) !== Date.parse(periodOrder.deal_date) ||
        ['user_id', 'profile_id', 'product_id', 'tariff_id'].some(k => !periodOrder[k]) ||
        (payment.user_id && payment.user_id !== periodOrder.user_id) ||
        (payment.profile_id && payment.profile_id !== periodOrder.profile_id)) {
      return { kind: 'hold', reason: 'receipt_sync_period_proof_mismatch' };
    }
    if (incoming && (!paidTransaction(incoming) || !Number.isInteger(incoming.amount) ||
        !money(incoming.amount / 100, payment.amount) || incoming.currency !== payment.currency ||
        !date(incoming.paid_at || incoming.created_at) ||
        Date.parse(incoming.paid_at || incoming.created_at) !== Date.parse(payment.paid_at))) {
      return { kind: 'hold', reason: 'receipt_sync_event_mismatch' };
    }
    const parentId = periodOrder.meta?.parent_order_id;
    const parent = parentId && UUID.test(parentId)
      ? await checked(db.from('orders_v2').select('*').eq('id', parentId).maybeSingle()) : null;
    if (!parent || parent.id === periodOrder.id || parent.is_deleted ||
        ['user_id', 'profile_id', 'product_id', 'tariff_id'].some(k => parent[k] !== periodOrder[k])) {
      return { kind: 'hold', reason: 'receipt_sync_parent_mismatch' };
    }
    return { kind: 'preserved', orderId: periodOrder.id, historical: false };
  } catch {
    return { kind: 'hold', reason: 'receipt_sync_lookup_failed' };
  }
}

/** Narrow legacy enrichment only. Re-read intent, then CAS the receipt version
 * and link so a concurrent period repair cannot be overwritten after waiting
 * for its row lock. There is deliberately no API for changing identity fields.
 */
export async function updateLegacyReceipt(db: any, uid: string, expected: any, patch: any) {
  const allowed = new Set(['status', 'transaction_type', 'paid_at', 'provider_response',
    'card_last4', 'card_brand', 'updated_at', 'meta', 'amount']);
  if (Object.keys(patch).some(k => !allowed.has(k))) throw new Error('receipt_sync_identity_patch_forbidden');
  const fresh = await inspectReceiptSync(db, uid);
  if (fresh.kind !== 'existing' || !expected?.updated_at || fresh.payment.id !== expected.id ||
      fresh.payment.updated_at !== expected.updated_at || fresh.payment.order_id !== expected.order_id) return false;
  const values = { ...patch, ...(patch.meta ? { meta: { ...(fresh.payment.meta || {}), ...patch.meta } } : {}) };
  let query = db.from('payments_v2').update(values).eq('id', expected.id)
    .eq('provider', 'bepaid').eq('provider_payment_id', uid).eq('updated_at', expected.updated_at);
  query = expected.order_id ? query.eq('order_id', expected.order_id) : query.is('order_id', null);
  const result = await query.select('id').maybeSingle();
  if (result.error) throw new Error('receipt_sync_update_failed');
  return result.data?.id === expected.id;
}

/** Only enqueue an unseen, provider-reported paid UID. Canonical recovery will
 * GET the provider again, prove identity/refunds/cancellation and materialize
 * the exact period order. No payment/order/access write belongs in this helper.
 * Existing jobs, including failed/backoff/manual/cancelled/processing, are NEVER
 * reset or stolen. A unique-key race is re-read, never turned into an upsert.
 */
export async function enqueueReceiptForRecovery(db: any, tx: any, source: string,
  providerSubscriptionId?: string | null) {
  const decision = await inspectReceiptSync(db, tx?.uid, tx);
  if (decision.kind !== 'absent') return decision;
  const tracking = parseBepaidTrackingId(tx.tracking_id);
  const paidAt = tx.paid_at || tx.created_at;
  if (!paidTransaction(tx) || !Number.isInteger(tx.amount) || tx.amount <= 0 ||
      !/^[A-Z]{3}$/.test(tx.currency || '') || !date(paidAt) ||
      !tracking.orderId || !UUID.test(tracking.orderId) ||
      (tracking.kind === 'subv2' && (!tracking.subscriptionV2Id || !UUID.test(tracking.subscriptionV2Id))) ||
      (providerSubscriptionId && !SBS.test(providerSubscriptionId))) {
    return { kind: 'hold' as const, reason: 'receipt_sync_incomplete_transaction' };
  }
  const readQueue = () => checked(db.from('payment_reconcile_queue')
    .select('id,status,attempts,matched_order_id,last_error,updated_at')
    .eq('provider', 'bepaid').eq('bepaid_uid', tx.uid).maybeSingle());
  const present = (q: any) => ({ kind: 'queued_existing' as const, queueId: q.id,
    queueStatus: q.status, fulfillment_verified: false });
  try {
    const existing = await readQueue();
    if (existing) return present(existing);
    const raw = { uid: tx.uid, type: tx.type, status: tx.status, amount: tx.amount,
      currency: tx.currency, paid_at: paidAt, created_at: tx.created_at,
      tracking_id: tx.tracking_id,
      ...(providerSubscriptionId ? { subscription_id: providerSubscriptionId } : {}),
      ...(tx.subscription_id && SBS.test(tx.subscription_id) ? { subscription_id: tx.subscription_id } : {}),
    };
    if (providerSubscriptionId && tx.subscription_id && tx.subscription_id !== providerSubscriptionId) {
      return { kind: 'hold' as const, reason: 'receipt_sync_subscription_conflict' };
    }
    const inserted = await db.from('payment_reconcile_queue').insert({ provider: 'bepaid',
      bepaid_uid: tx.uid, tracking_id: tx.tracking_id, amount: tx.amount / 100,
      currency: tx.currency, paid_at: paidAt, created_at_bepaid: tx.created_at || paidAt,
      status: 'pending', status_normalized: 'successful', transaction_type: 'payment',
      source, raw_payload: raw,
    }).select('id').maybeSingle();
    if (inserted.error?.code === '23505') {
      const winner = await readQueue();
      if (winner) return present(winner);
    }
    if (inserted.error || !inserted.data?.id) throw new Error('queue_insert_failed');
    return { kind: 'queued' as const, queueId: inserted.data.id, fulfillment_verified: false };
  } catch {
    return { kind: 'hold' as const, reason: 'receipt_sync_queue_failed' };
  }
}
