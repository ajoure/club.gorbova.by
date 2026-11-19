import { zg27SubscriptionProvenance } from './zg27-access-policy.ts';
import { validateZg27InstallmentContract, type Zg27InstallmentContract, generateZg27InstallmentSchedule } from './zg27-installments.ts';

export function freezeZg27Consent(plan: Zg27InstallmentContract, raw: any, userId: string, now = new Date()) {
  if (!userId || raw?.accepted !== true || raw?.policy_version !== plan.policy_version
    || raw?.interval_days !== 30 || raw?.total_minor !== plan.total_minor
    || JSON.stringify(raw?.amounts_minor) !== JSON.stringify(plan.amounts_minor)) throw Error('zg27_schedule_consent_required');
  const text = `Оплата ${plan.amounts_minor.map(n => (n / 100).toFixed(2)).join(' + ')} BYN: первый платёж сейчас, следующие автоматические списания каждые 30 дней. Подключение автоплатежей обязательно. Согласен на все списания по этому конечному графику.`;
  return { accepted: true, policy_version: plan.policy_version, user_id: userId, accepted_at: now.toISOString(),
    amounts_minor: plan.amounts_minor, total_minor: plan.total_minor, interval_days: 30, text };
}
export function validateZg27HostedMeta(meta: any, productId: string, tariffId: string, userId: string) {
  const plan = validateZg27InstallmentContract(meta?.zg27_installment, productId, tariffId);
  const consent = meta?.zg27_schedule_consent;
  if (!consent || !Number.isFinite(Date.parse(consent.accepted_at)) || consent.user_id !== userId) throw Error('zg27_schedule_consent_required');
  const expected = freezeZg27Consent(plan, consent, userId, new Date(consent.accepted_at));
  if (expected.text !== consent.text) throw Error('zg27_schedule_consent_required');
  return plan;
}
/** Official widget contract: contract belongs inside checkout.order.additional_data. */
export function zg27HostedWidgetFields() {
  return { additional_data: { contract: ['recurring'] } };
}

/** Runs after canonical receipt settlement and BEFORE access finalization; never grants access or charges. */
export async function handoffZg27HostedReceipt(db: any, orderId: string, paymentId: string, transaction: any) {
  const fail = (reason: string) => ({ state: 'setup_failed' as const, reason });
  const { data: order, error } = await db.from('orders_v2').select('id,user_id,product_id,tariff_id,currency,meta,final_price').eq('id', orderId).maybeSingle();
  if (error || !order) throw Error('zg27_handoff_order_unavailable');
  const plan = validateZg27HostedMeta(order.meta, order.product_id, order.tariff_id, order.user_id);
  if (Math.round(Number(order.final_price) * 100) !== plan.total_minor || order.currency !== 'BYN') throw Error('zg27_handoff_order_mismatch');
  const { data: pay, error: pe } = await db.from('payments_v2').select('id,order_id,user_id,status,provider,provider_payment_id,amount,currency,refunded_amount,is_deleted').eq('id', paymentId).maybeSingle();
  if (pe || !pay || pay.order_id !== order.id || pay.user_id !== order.user_id || pay.provider !== 'bepaid'
    || pay.provider_payment_id !== transaction?.uid || pay.status !== 'succeeded' || pay.is_deleted
    || Number(pay.refunded_amount || 0) !== 0 || pay.currency !== 'BYN' || transaction?.currency !== 'BYN'
    || Math.round(Number(pay.amount) * 100) !== plan.amounts_minor[0] || transaction.amount !== plan.amounts_minor[0]
    || transaction.status !== 'successful') throw Error('zg27_handoff_receipt_mismatch');
  const { data: sub, error: se } = await db.from('subscriptions_v2').select('id,user_id,product_id,tariff_id,order_id,meta,payment_method_id').eq('order_id', order.id).maybeSingle();
  if (se) throw Error('zg27_handoff_subscription_unavailable');
  let canonical = sub;
  if (!canonical) {
    const { data: extended, error: ee } = await db.from('subscriptions_v2').select('id,user_id,product_id,tariff_id,order_id,meta,payment_method_id')
      .eq('user_id', order.user_id).eq('product_id', order.product_id).eq('tariff_id', order.tariff_id)
      .contains('meta', { extended_by_orders: [order.id] }).maybeSingle();
    if (ee) throw Error('zg27_handoff_subscription_unavailable');
    canonical = extended;
  }
  if (!zg27SubscriptionProvenance(canonical, order)) return fail('canonical_subscription_missing');
  // Only this verified transaction's returned token. Never stamps/email/last4/subscription fallback.
  const token = transaction.credit_card?.token;
  if (typeof token !== 'string' || !token.trim()) {
    const saved = canonical.meta?.zg27_installment_orders?.[order.id];
    if (saved?.payment_id === pay.id && saved.payment_method_id === canonical.payment_method_id
      && canonical.meta?.zg27_hosted_recurring_consent === true) {
      const result = await generateZg27InstallmentSchedule({ supabase: db, order, subscription: canonical,
        user: { id: order.user_id }, firstPayment: { paymentId: pay.id }, currency: 'BYN' });
      if (result.ok) return { state: 'ready' as const };
    }
    return fail('provider_token_missing');
  }
  const { data: known, error: ke } = await db.from('payment_methods').select('id,user_id,status').eq('provider', 'bepaid').eq('provider_token', token).maybeSingle();
  if (ke) throw Error('zg27_handoff_card_unavailable');
  if (known && (known.user_id !== order.user_id || known.status !== 'active')) return fail('provider_token_ownership_conflict');
  let cardId = known?.id;
  if (!cardId) {
    const { data: card, error: ce } = await db.from('payment_methods').insert({ user_id: order.user_id, provider: 'bepaid', provider_token: token,
      status: 'active', is_default: false, brand: transaction.credit_card?.brand, last4: transaction.credit_card?.last_4 }).select('id').single();
    if (ce || !card?.id) throw Error('zg27_handoff_card_insert_failed');
    cardId = card.id;
  }
  const binding = canonical.meta?.zg27_installment_orders?.[order.id];
  if (binding && (binding.payment_id !== pay.id || binding.payment_method_id !== cardId)) return fail('mandate_binding_conflict');

  // Recover only the old canonical grant's incidental default binding for THIS order.
  // Any committed ZG27 mandate (including another order) remains immutable.
  const incidentalDefault = canonical.meta?.granted_by === 'grant-access-for-order'
    && canonical.meta?.initial_order_id === order.id && canonical.order_id === order.id
    && canonical.meta?.zg27_hosted_recurring_consent !== true
    && Object.keys(canonical.meta?.zg27_installment_orders || {}).length === 0;
  if (canonical.payment_method_id && canonical.payment_method_id !== cardId && !incidentalDefault) return fail('mandate_binding_conflict');
  const { error: ue } = await db.from('subscriptions_v2').update({ billing_type: 'mit', auto_renew: false, payment_method_id: cardId,
    meta: { ...canonical.meta, zg27_hosted_recurring_consent: true, zg27_first_payment_id: pay.id, model: 'zg27_application_managed_v1', zg27_setup: 'mandate_verified', zg27_autopay_required:true,
      zg27_installment_orders: { ...canonical.meta?.zg27_installment_orders, [order.id]: { payment_id: pay.id, payment_method_id: cardId, policy_version: 'zg27-v1' } } }
    }).eq('id', canonical.id).eq('user_id', order.user_id);
  if (ue) throw Error('zg27_handoff_binding_failed');
  const result = await generateZg27InstallmentSchedule({ supabase: db, order, subscription: canonical,
    user: { id: order.user_id }, firstPayment: { paymentId: pay.id }, currency: 'BYN' });
  if (!result.ok) throw Error(result.error);
  return { state: 'ready' as const };
}
