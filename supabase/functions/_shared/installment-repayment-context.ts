import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { moneyMinor, repaymentBalance, RepaymentPlanError, splitRemainingDebt } from './installment-repayment-plan.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function loadInstallmentRepaymentContext(db: SupabaseClient, orderId: string) {
  if (!UUID.test(orderId)) throw new RepaymentPlanError('invalid_order_id');
  const { data: order, error: orderError } = await db.from('orders_v2')
    .select('id,user_id,profile_id,product_id,tariff_id,status,currency,meta,updated_at,responsible_user_id')
    .eq('id', orderId).maybeSingle();
  if (orderError) throw new RepaymentPlanError('repayment_read_failed');
  if (!order?.user_id || !order.product_id || !order.tariff_id || !['paid', 'partial'].includes(order.status)) {
    throw new RepaymentPlanError('paid_installment_not_found');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy JSON agreement is validated field by field below
  const orderMeta = order.meta as Record<string, any>;
  const agreement = orderMeta?.installment;
  if (orderMeta?.manual_review || !agreement || agreement.model !== 'bepaid_finite_subscription'
      || agreement.infinite !== false || agreement.original_order_id !== order.id) {
    throw new RepaymentPlanError('installment_agreement_requires_review');
  }
  if (order.currency !== 'BYN' || !Number.isInteger(agreement.billing_cycles) || agreement.billing_cycles < 2) {
    throw new RepaymentPlanError('unsupported_installment_agreement');
  }
  const { data: subs, error: subError } = await db.from('subscriptions_v2')
    .select('id,order_id,user_id,product_id,tariff_id,status,meta,access_start_at,access_end_at,next_charge_at,updated_at')
    .eq('order_id', order.id).eq('user_id', order.user_id).eq('product_id', order.product_id).eq('tariff_id', order.tariff_id);
  if (subError) throw new RepaymentPlanError('repayment_read_failed');
  if (subs?.length !== 1) throw new RepaymentPlanError('installment_subscription_ambiguous');
  const sub = subs[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy JSON agreement is validated field by field below
  const subAgreement = (sub.meta as Record<string, any>)?.installment;
  for (const field of ['model', 'infinite', 'original_order_id', 'billing_cycles', 'per_payment_byn', 'effective_total_byn']) {
    if (subAgreement?.[field] !== agreement[field]) throw new RepaymentPlanError('installment_snapshot_mismatch');
  }
  const { data: providers, error: providerError } = await db.from('provider_subscriptions')
    .select('id,provider,provider_subscription_id,subscription_v2_id,order_id,user_id,state,meta,updated_at')
    .eq('subscription_v2_id', sub.id);
  if (providerError) throw new RepaymentPlanError('repayment_read_failed');
  if (!providers?.length) throw new RepaymentPlanError('installment_provider_missing');
  if (providers.some(p => p.provider !== 'bepaid' || p.user_id !== order.user_id || p.order_id !== order.id)) {
    throw new RepaymentPlanError('installment_provider_identity_mismatch');
  }
  const terminal = new Set(['canceled', 'cancelled', 'failed', 'expired', 'completed', 'terminated']);
  const liveProviders = providers.filter(p => !terminal.has(p.state));
  if (liveProviders.length > 1) throw new RepaymentPlanError('installment_multiple_live_mandates');
  if (liveProviders.some(p => !p.provider_subscription_id)) {
    throw new RepaymentPlanError('installment_live_mandate_identity_missing');
  }
  const { data: payments, error: paymentsError } = await db.from('payments_v2')
    .select('id,order_id,user_id,currency,provider,provider_payment_id,status,amount,refunded_amount,is_deleted,transaction_type,updated_at')
    .eq('order_id', order.id);
  if (paymentsError) throw new RepaymentPlanError('repayment_read_failed');
  const balance = repaymentBalance({ orderId: order.id, userId: order.user_id, currency: order.currency,
    total: agreement.effective_total_byn, payments: payments ?? [] });
  const fingerprintInput = JSON.stringify({ order: order.updated_at, sub: sub.updated_at,
    providers: providers.map(p => [p.id, p.updated_at, p.state]).sort(),
    payments: (payments ?? []).map(p => [p.id, p.updated_at, p.status, p.amount, p.refunded_amount, p.is_deleted]).sort() });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintInput));
  const fingerprint = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { order, sub, providers, liveProviders, agreement, balance, fingerprint };
}

export function quoteInstallmentRepayment(context: Awaited<ReturnType<typeof loadInstallmentRepaymentContext>>, input: {
  count?: number; payment_type: 'one_time' | 'subscription'; interval_days?: number;
}) {
  if (!['one_time', 'subscription'].includes(input.payment_type)) throw new RepaymentPlanError('invalid_payment_type');
  const perPayment = moneyMinor(context.agreement.per_payment_byn);
  if (perPayment <= 0) throw new RepaymentPlanError('invalid_installment_amount');
  const count = input.count ?? Math.max(1, Math.ceil(context.balance.remainingMinor / perPayment));
  const scheduleMinor = splitRemainingDebt(context.balance.remainingMinor, count);
  const intervalDays = input.interval_days ?? context.agreement.interval_days ?? 30;
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 366) throw new RepaymentPlanError('invalid_repayment_interval');
  const uniform = scheduleMinor.every(n => n === scheduleMinor[0]);
  if (input.payment_type === 'subscription' && (count < 2 || !uniform)) {
    throw new RepaymentPlanError('autopay_requires_equal_remaining_payments');
  }
  return {
    contract_version: 1, original_order_id: context.order.id, subscription_v2_id: context.sub.id,
    currency: context.order.currency, total_minor: context.balance.totalMinor,
    paid_minor: context.balance.paidMinor, paid_count: context.balance.paidCount,
    remaining_minor: context.balance.remainingMinor, schedule_minor: scheduleMinor,
    interval_days: intervalDays, payment_type: input.payment_type,
    replaces_live_mandate: context.liveProviders.length > 0, fingerprint: context.fingerprint,
    replaces_provider_subscription_id: context.liveProviders[0]?.provider_subscription_id ?? null,
    preserves_purchase: true, changes_access: false,
  };
}
