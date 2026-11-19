import { zg27SubscriptionProvenance } from './zg27-access-policy.ts';
import { ZG27_PRODUCT_ID, ZG27_TIERS, zg27InstallmentAmounts } from './zg27-policy.ts';

export const ZG27_INSTALLMENT_MODEL = 'zg27_application_managed_v1';
export type Zg27InstallmentContract = {
  model: typeof ZG27_INSTALLMENT_MODEL; policy_version: 'zg27-v1'; tier: 'first' | 'repeat';
  offer_id: string; amounts_minor: number[]; total_minor: number; interval_days: 30;
  first_payment_delay_days: 0; consent_contract: 'hosted_recurring_v1';
};

/** Trusted server offer only; never compute a contract from a client's amount. */
export function zg27InstallmentContract(input: {
  productId: string; tariffId: string; offerId: string; offerTariffId: string;
  amountByn: number; currency: string; count: number; intervalDays: number; firstDelayDays: number;
}): Zg27InstallmentContract {
  const tier = input.tariffId === ZG27_TIERS.first.tariffId ? 'first'
    : input.tariffId === ZG27_TIERS.repeat.tariffId ? 'repeat' : null;
  if (input.productId !== ZG27_PRODUCT_ID || !tier || !input.offerId || input.offerTariffId !== input.tariffId
    || input.currency !== 'BYN' || input.amountByn * 100 !== ZG27_TIERS[tier].totalMinor
    || ![2, 3].includes(input.count) || input.intervalDays !== 30 || input.firstDelayDays !== 0) {
    throw new Error('zg27_installment_contract_invalid');
  }
  return { model: ZG27_INSTALLMENT_MODEL, policy_version: 'zg27-v1', tier, offer_id: input.offerId,
    amounts_minor: zg27InstallmentAmounts(tier, input.count).map(n => Math.round(n * 100)),
    total_minor: ZG27_TIERS[tier].totalMinor, interval_days: 30, first_payment_delay_days: 0,
    consent_contract: 'hosted_recurring_v1' };
}

/** Independent reconstruction catches forged per-row metadata and uniform totals. */
export function validateZg27InstallmentContract(raw: unknown, productId: string, tariffId: string): Zg27InstallmentContract {
  if (!raw || typeof raw !== 'object') throw new Error('zg27_installment_contract_invalid');
  const p = raw as Zg27InstallmentContract;
  const expected = zg27InstallmentContract({ productId, tariffId, offerId: p.offer_id,
    offerTariffId: tariffId, amountByn: Number(p.total_minor) / 100, currency: 'BYN',
    count: Array.isArray(p.amounts_minor) ? p.amounts_minor.length : 0,
    intervalDays: p.interval_days, firstDelayDays: p.first_payment_delay_days });
  if (p.model !== expected.model || p.policy_version !== expected.policy_version || p.tier !== expected.tier
    || p.consent_contract !== expected.consent_contract || p.amounts_minor.some((v, i) => v !== expected.amounts_minor[i])) {
    throw new Error('zg27_installment_contract_invalid');
  }
  return expected;
}

/** Provider-uniform routes cannot represent the approved final remainder. */
export function requireZg27InstallmentExecution(input: { productId: string; count: number; mode: string }) {
  if (input.productId === ZG27_PRODUCT_ID && (!Number.isInteger(input.count) || input.count < 1 || input.count > 3
    || (input.count > 1 && input.mode !== ZG27_INSTALLMENT_MODEL))) {
    throw new Error('zg27_requires_application_managed_installments');
  }
}

// No token acquisition/charge lives here. This boundary only schedules an
// ALREADY confirmed first receipt with a verified owned card and hosted consent.
// deno-lint-ignore no-explicit-any
export async function generateZg27InstallmentSchedule(params: any): Promise<
  | { ok: false; error: string }
  | { ok: true; created: false; reason: 'already_exists'; existing_count: number }
  | { ok: true; created: true; count: number; per_payment_amount: number }
> {
  const { supabase: db, order, subscription, user, firstPayment, currency } = params;
  const fail = (error: string) => ({ ok: false as const, error });
  try {
    const { data: actual, error: orderError } = await db.from('orders_v2')
      .select('id,product_id,tariff_id,user_id,currency,meta').eq('id', order.id).maybeSingle();
    if (orderError || !actual || actual.user_id !== user.id || currency !== 'BYN' || actual.currency !== 'BYN') return fail('zg27_schedule_identity_invalid');
    const plan = validateZg27InstallmentContract(actual.meta?.zg27_installment, actual.product_id, actual.tariff_id);
    if (!firstPayment?.paymentId) return fail('zg27_first_payment_required');
    const { data: pay, error: payError } = await db.from('payments_v2')
      .select('id,order_id,user_id,status,provider,amount,currency,refunded_amount,is_deleted,paid_at')
      .eq('id', firstPayment.paymentId).maybeSingle();
    if (payError || !pay || pay.order_id !== actual.id || pay.user_id !== user.id || pay.status !== 'succeeded'
      || pay.provider !== 'bepaid' || pay.currency !== 'BYN' || pay.is_deleted || Number(pay.refunded_amount || 0) !== 0
      || Math.abs(Number(pay.amount) * 100 - plan.amounts_minor[0]) > 0.000001 || !Number.isFinite(Date.parse(pay.paid_at))) return fail('zg27_first_payment_not_confirmed');
    const { data: sub, error: subError } = await db.from('subscriptions_v2')
      .select('id,order_id,user_id,product_id,tariff_id,payment_method_id,auto_renew,billing_type,meta')
      .eq('id', subscription.id).maybeSingle();
    if (subError || !sub || !zg27SubscriptionProvenance(sub, actual) || sub.product_id !== actual.product_id
      || sub.tariff_id !== actual.tariff_id || sub.auto_renew !== false || sub.billing_type !== 'mit'
      || (!sub.payment_method_id || sub.meta?.zg27_hosted_recurring_consent !== true
      || (sub.order_id !== actual.id && (sub.meta?.zg27_installment_orders?.[actual.id]?.payment_id !== pay.id
        || sub.meta?.zg27_installment_orders?.[actual.id]?.payment_method_id !== sub.payment_method_id)))) return fail('zg27_owned_mandate_required');
    const { data: card, error: cardError } = await db.from('payment_methods')
      .select('id,user_id,status,provider,provider_token').eq('id', sub.payment_method_id).maybeSingle();
    if (cardError || !card || card.user_id !== user.id || card.status !== 'active' || card.provider !== 'bepaid' || !card.provider_token) return fail('zg27_owned_mandate_required');
    const rows = plan.amounts_minor.map((minor, i) => ({ subscription_id: sub.id, order_id: actual.id, user_id: user.id,
      payment_number: i + 1, total_payments: plan.amounts_minor.length, amount: minor / 100, currency: 'BYN',
      due_date: new Date(Date.parse(pay.paid_at) + i * 30 * 86400000).toISOString(),
      status: i === 0 ? 'succeeded' : 'pending', paid_at: i === 0 ? pay.paid_at : null, payment_id: i === 0 ? pay.id : null }));
    const read = async () => {
      const result = await db.from('installment_payments').select('*').eq('order_id', actual.id);
      if (result.error) throw new Error('zg27_schedule_read_failed');
      return result.data || [];
    };
    // deno-lint-ignore no-explicit-any
    const matches = (existing: any[]) => existing.length === rows.length && rows.every(expected => {
      const found = existing.filter(v => v.payment_number === expected.payment_number);
      return found.length === 1 && ['pending', 'processing', 'succeeded', 'failed'].includes(found[0].status)
        && (['subscription_id', 'order_id', 'user_id', 'total_payments', 'currency'] as const).every(k => found[0][k] === expected[k])
        && Math.abs(Number(found[0].amount) * 100 - Math.round(expected.amount * 100)) < 0.000001
        && Date.parse(found[0].due_date) === Date.parse(expected.due_date)
        && (expected.payment_number !== 1 || (found[0].status === 'succeeded' && found[0].payment_id === pay.id));
    });
    const existing = await read();
    if (existing.length) return matches(existing)
      ? { ok: true, created: false, reason: 'already_exists', existing_count: existing.length }
      : fail('zg27_schedule_existing_mismatch');
    const { error } = await db.from('installment_payments').insert(rows);
    if (error && error.code !== '23505') return fail('zg27_schedule_insert_failed');
    // A unique-key race is re-read; no upsert/reset of already charged rows.
    if (!matches(await read())) return fail('zg27_schedule_readback_mismatch');
    if (error) return { ok: true, created: false, reason: 'already_exists', existing_count: rows.length };
    return { ok: true, created: true, count: rows.length, per_payment_amount: rows[0].amount };
  } catch (error) {
    return fail(error instanceof Error && /^zg27_[a-z_]+$/.test(error.message) ? error.message : 'zg27_schedule_unavailable');
  }
}
