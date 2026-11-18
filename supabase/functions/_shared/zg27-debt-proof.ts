import { ZG27_PRODUCT_ID } from './zg27-policy.ts';
import { validateZg27HostedMeta } from './zg27-hosted-installments.ts';
import { zg27SubscriptionProvenance } from './zg27-access-policy.ts';
/** Read-only debt authorization. Expired access is independent of an explicitly agreed unpaid installment. */
export async function resolveZg27DebtToken(db: any, subscriptionId: string, installmentId: string, now = new Date()): Promise<{ token: string; payment_method_id: string } | null> {
  try {
    const get = async (table: string, id: string) => {
      const r = await db.from(table).select('*').eq('id', id).maybeSingle();
      if (r.error || !r.data) throw Error('debt_proof_unavailable'); return r.data;
    };
    const row = await get('installment_payments', installmentId);
    if (row.subscription_id !== subscriptionId || !['pending','processing'].includes(row.status)
      || !Number.isInteger(row.payment_number) || row.payment_number <= 1 || row.currency !== 'BYN'
      || !Number.isFinite(Date.parse(row.due_date)) || Date.parse(row.due_date) > now.getTime()) return null;
    const order = await get('orders_v2', row.order_id);
    if (order.product_id !== ZG27_PRODUCT_ID || row.user_id !== order.user_id || order.is_deleted
      || ['canceled','refunded'].includes(order.status)) return null;
    const plan = validateZg27HostedMeta(order.meta, order.product_id, order.tariff_id, order.user_id);
    if (Math.round(Number(order.final_price) * 100) !== plan.total_minor || row.total_payments !== plan.amounts_minor.length
      || row.payment_number > plan.amounts_minor.length || Math.round(Number(row.amount) * 100) !== plan.amounts_minor[row.payment_number - 1]) return null;
    const sub = await get('subscriptions_v2', subscriptionId);
    const binding = sub.meta?.zg27_installment_orders?.[order.id];
    if (!zg27SubscriptionProvenance(sub, order) || !['active','trial','expired'].includes(sub.status)
      || sub.billing_type !== 'mit' || sub.auto_renew !== false || sub.meta?.zg27_hosted_recurring_consent !== true
      || binding?.policy_version !== 'zg27-v1' || !binding.payment_id || binding.payment_method_id !== sub.payment_method_id) return null;
    const first = await get('payments_v2', binding.payment_id);
    if (first.order_id !== order.id || first.user_id !== order.user_id || first.status !== 'succeeded' || first.provider !== 'bepaid'
      || first.currency !== 'BYN' || first.is_deleted || Number(first.refunded_amount || 0) !== 0
      || Math.round(Number(first.amount) * 100) !== plan.amounts_minor[0] || !Number.isFinite(Date.parse(first.paid_at))
      || Date.parse(row.due_date) !== Date.parse(first.paid_at) + (row.payment_number - 1) * 30 * 86400000) return null;
    const { data: payments, error } = await db.from('payments_v2').select('status,refunded_amount,is_deleted').eq('order_id', order.id);
    if (error || !payments || payments.some((p: any) => !p.is_deleted && (Number(p.refunded_amount || 0) > 0 || ['refunded','partially_refunded'].includes(p.status)))) return null;
    const card = await get('payment_methods', binding.payment_method_id);
    if (card.user_id !== order.user_id || card.provider !== 'bepaid' || card.status !== 'active' || typeof card.provider_token !== 'string' || !card.provider_token.trim()) return null;
    return { token: card.provider_token, payment_method_id: card.id };
  } catch { return null; }
}
