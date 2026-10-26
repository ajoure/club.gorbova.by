// Financial reconstruction is deliberately NOT access fulfillment. These
// markers are written only by a separately reviewed bounded data repair.
// No provider calls, queue claims, audit inserts, or other writes here.
// deno-lint-ignore-file no-explicit-any
export const HISTORICAL_RECEIPT_RUN = '20261026_legacy_periodic_repair';

export type HistoricalReceiptDecision =
  | { kind: 'none' }
  | { kind: 'preserved'; orderId: string; parentOrderId: string }
  | { kind: 'hold'; reason: string };

export function hasHistoricalReceiptMarker(meta: any): boolean {
  return !!meta && (Object.hasOwn(meta, 'reconstructed_historical_deal') ||
    Object.hasOwn(meta, 'historical_repair_run') ||
    Object.hasOwn(meta, 'historical_access_mode') ||
    meta.grant_status === 'historical_retained_on_parent');
}

const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const sameMoney = (a: unknown, b: unknown) => a !== null && b !== null &&
  Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b);

/** Look up the canonical deterministic number first (indexed, no fuzzy IDs).
 * A marker alone is never proof: verify the one existing receipt, exact UID,
 * amount/currency/date/identity and original parent before acknowledging replay.
 * Lookup errors and malformed/partial markers always stop, never fall back.
 */
export async function inspectHistoricalReceipt(
  db: any, uid: string | null | undefined,
  incoming?: { amount: unknown; currency: unknown; paidAt: unknown; status: unknown; type?: unknown },
): Promise<HistoricalReceiptDecision> {
  if (!uid || typeof uid !== 'string') return { kind: 'none' };
  try {
    const read = async (query: any) => {
      const r = await query;
      if (r.error) throw new Error('lookup');
      return r.data;
    };
    const orderFields = 'id,order_number,user_id,profile_id,product_id,tariff_id,status,is_deleted,provider,provider_payment_id,currency,final_price,paid_amount,deal_date,meta';
    const canonical = await read(db.from('orders_v2').select(orderFields)
      .eq('order_number', `REBILL-${uid.slice(0, 12)}`).maybeSingle());
    const payment = await read(db.from('payments_v2').select('id,order_id,user_id,profile_id,provider,provider_payment_id,status,is_deleted,transaction_type,refunded_amount,amount,currency,paid_at')
      .eq('provider', 'bepaid').eq('provider_payment_id', uid).maybeSingle());
    const linked = payment?.order_id && payment.order_id !== canonical?.id
      ? await read(db.from('orders_v2').select(orderFields).eq('id', payment.order_id).maybeSingle()) : canonical;
    const order = hasHistoricalReceiptMarker(canonical?.meta) ? canonical : linked;
    if (!hasHistoricalReceiptMarker(order?.meta)) return { kind: 'none' };
    if (hasHistoricalReceiptMarker(canonical?.meta) && hasHistoricalReceiptMarker(linked?.meta) && canonical.id !== linked.id) {
      return { kind: 'hold', reason: 'historical_receipt_multiple_orders' };
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return { kind: 'hold', reason: 'historical_receipt_invalid_uid' };
    const m = order.meta;
    if (m.reconstructed_historical_deal !== true || m.historical_repair_run !== HISTORICAL_RECEIPT_RUN ||
        m.historical_access_mode !== 'retained_on_parent' || m.do_not_grant_access !== true ||
        m.grant_status !== 'historical_retained_on_parent' ||
        m.materialization_status !== 'reconstructed_historical_deal' ||
        !m.historical_parent_order_id || !m.historical_receipt_payment_id ||
        m.parent_order_id !== m.historical_parent_order_id ||
        m.materialized_from_payment_uid !== uid || order.order_number !== `REBILL-${uid.slice(0, 12)}` || order.provider !== 'bepaid' ||
        order.provider_payment_id !== uid || order.status !== 'paid' || order.is_deleted === true ||
        !validDate(order.deal_date) || !sameMoney(order.paid_amount, order.final_price) ||
        !(Number(order.final_price) > 0)) {
      return { kind: 'hold', reason: 'historical_receipt_marker_mismatch' };
    }
    const parent = await read(db.from('orders_v2').select('id,user_id,profile_id,product_id,tariff_id,is_deleted')
      .eq('id', m.historical_parent_order_id).maybeSingle());
    if (!payment || !parent || parent.id === order.id || parent.is_deleted === true ||
        payment.id !== m.historical_receipt_payment_id || payment.order_id !== order.id ||
        payment.status !== 'succeeded' || payment.is_deleted === true ||
        !['Платеж', 'payment'].includes(payment.transaction_type) || Number(payment.refunded_amount || 0) !== 0 ||
        !sameMoney(payment.amount, order.final_price) || payment.currency !== order.currency ||
        !validDate(payment.paid_at) || Date.parse(payment.paid_at) !== Date.parse(order.deal_date) ||
        !order.user_id || !order.profile_id || !order.product_id || !order.tariff_id ||
        ['user_id', 'profile_id', 'product_id', 'tariff_id'].some(k => parent[k] !== order[k]) ||
        (payment.user_id && payment.user_id !== order.user_id) ||
        (payment.profile_id && payment.profile_id !== order.profile_id)) {
      return { kind: 'hold', reason: 'historical_receipt_proof_mismatch' };
    }
    if (incoming && (!sameMoney(incoming.amount, payment.amount) || incoming.currency !== payment.currency ||
        !validDate(incoming.paidAt) || Date.parse(incoming.paidAt) !== Date.parse(payment.paid_at) ||
        !['successful', 'success', 'succeeded', 'paid'].includes(String(incoming.status)) ||
        !['payment', 'charge', 'sale'].includes(String(incoming.type)))) {
      return { kind: 'hold', reason: 'historical_receipt_event_mismatch' };
    }
    return { kind: 'preserved', orderId: order.id, parentOrderId: parent.id };
  } catch {
    return { kind: 'hold', reason: 'historical_receipt_lookup_failed' };
  }
}

export async function historicalWebhookReplay(db: any, body: any, cors: Record<string, string>): Promise<Response | null> {
  const tx = body?.transaction || body?.last_transaction || body?.subscription?.last_transaction;
  const decision = await inspectHistoricalReceipt(db, tx?.uid, tx ? {
    amount: typeof tx.amount === 'number' ? tx.amount / 100 : null,
    currency: tx.currency, paidAt: tx.paid_at, status: tx.status, type: tx.type,
  } : undefined);
  if (decision.kind === 'none') return null;
  return new Response(JSON.stringify({ ok: decision.kind === 'preserved',
    status: decision.kind === 'preserved' ? 'historical_receipt_preserved' : 'manual_review',
    ...(decision.kind === 'hold' ? { reason: decision.reason } : {}), access_changed: false }),
    { status: decision.kind === 'preserved' ? 200 : 202,
      headers: { ...cors, 'Content-Type': 'application/json' } });
}
