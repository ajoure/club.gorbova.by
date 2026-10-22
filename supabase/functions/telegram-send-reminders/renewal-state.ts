// Read-only classification. A checkout draft is never evidence of an active mandate.
export type RenewalState = {
  mode: 'automatic' | 'manual' | 'skip';
  reason: string;
  subscriptionId?: string;
  tariffId?: string | null;
  nextChargeAt?: string;
};
type Subscription = {
  id: string; user_id: string; product_id: string; order_id: string | null;
  tariff_id: string | null; status: string; auto_renew: boolean;
  billing_type: string; access_end_at: string | null; meta?: Record<string, any> | null;
};
type Provider = {
  subscription_v2_id: string | null; user_id: string | null;
  order_id: string | null; state: string; next_charge_at: string | null;
};
type Order = { id: string; user_id: string | null; product_id: string | null; status: string; is_deleted: boolean };
const chargingStates = new Set(['active', 'trialing', 'past_due', 'failed_attempt']);
const skip = (reason: string): RenewalState => ({ mode: 'skip', reason });

function finite(meta: Subscription['meta']): boolean {
  return meta?.payment_method === 'internal_installment' ||
    meta?.model === 'bepaid_finite_subscription' ||
    meta?.installment?.model === 'bepaid_finite_subscription' ||
    meta?.installment_progress?.model === 'bepaid_finite_subscription' ||
    meta?.installment?.as_finite_subscription === true;
}

export function classifyRenewalState(input: {
  userId: string; productId: string; activeUntil: string | null; now: number;
  subscriptions: Subscription[]; providers: Provider[]; orders: Order[];
}): RenewalState {
  const { userId, productId, activeUntil, now, providers, orders } = input;
  const end = Date.parse(activeUntil ?? '');
  if (!Number.isFinite(end) || end <= now) return skip('invalid_access_period');
  const subs = input.subscriptions.filter(s => s.user_id === userId && s.product_id === productId);
  const active = subs.filter(s => ['active', 'trial'].includes(s.status));
  if (active.some(s => s.access_end_at === null || Date.parse(s.access_end_at) > end + 60_000)) {
    return skip('access_extended');
  }
  const paid = active.filter(s => Math.abs(Date.parse(s.access_end_at ?? '') - end) <= 60_000 &&
    orders.some(o => o.id === s.order_id && o.user_id === userId && o.product_id === productId &&
      o.status === 'paid' && !o.is_deleted));
  if (paid.length !== 1) return skip(paid.length ? 'ambiguous_paid_period' : 'no_paid_period');
  const sub = paid[0];
  const ids = new Set(subs.map(s => s.id));
  const orderIds = new Set(subs.map(s => s.order_id).filter(Boolean));
  // A live mandate on another draft of this product must not trigger a second checkout.
  // An unlinked mandate has unknown product ownership: fail closed, never infer.
  const live = providers.filter(p => chargingStates.has(p.state) &&
    (ids.has(p.subscription_v2_id ?? '') || orderIds.has(p.order_id ?? '') ||
      (!p.subscription_v2_id && !p.order_id)));
  if (finite(sub.meta)) return skip('finite_installment');
  if (live.length === 0) {
    if (sub.auto_renew) return skip('local_provider_conflict');
    return { mode: 'manual', reason: 'no_active_provider', subscriptionId: sub.id, tariffId: sub.tariff_id };
  }
  if (live.length !== 1) return skip('ambiguous_provider');
  const ps = live[0];
  if (ps.subscription_v2_id !== sub.id || ps.user_id !== userId ||
    (ps.order_id !== null && ps.order_id !== sub.order_id) ||
    !sub.auto_renew || sub.billing_type !== 'provider_managed') return skip('local_provider_conflict');
  if (!['active', 'trialing'].includes(ps.state)) return skip('provider_retrying');
  const next = Date.parse(ps.next_charge_at ?? '');
  if (!Number.isFinite(next) || next <= now) return skip('provider_schedule_unknown');
  return { mode: 'automatic', reason: 'confirmed_provider_schedule', subscriptionId: sub.id,
    tariffId: sub.tariff_id, nextChargeAt: ps.next_charge_at! };
}

export async function resolveRenewalState(db: any, userId: string, productId: string,
  activeUntil: string | null, now = Date.now()): Promise<RenewalState> {
  try {
    const { data: subscriptions, error: subError } = await db.from('subscriptions_v2')
      .select('id,user_id,product_id,order_id,tariff_id,status,auto_renew,billing_type,access_end_at,meta')
      .eq('user_id', userId).eq('product_id', productId).limit(101);
    if (subError || !subscriptions) return skip('subscription_lookup_failed');
    if (subscriptions.length > 100) return skip('subscription_limit');
    const orderIds = [...new Set(subscriptions.map((s: Subscription) => s.order_id).filter(Boolean))];
    if (!orderIds.length) return skip('no_paid_period');
    const { data: orders, error: orderError } = await db.from('orders_v2')
      .select('id,user_id,product_id,status,is_deleted').in('id', orderIds);
    if (orderError || !orders) return skip('order_lookup_failed');
    const { data: providers, error: providerError } = await db.from('provider_subscriptions')
      .select('subscription_v2_id,user_id,order_id,state,next_charge_at')
      .or(`user_id.eq.${userId},subscription_v2_id.in.(${subscriptions.map((s: Subscription) => s.id).join(',')})`).limit(101);
    if (providerError || !providers) return skip('provider_lookup_failed');
    if (providers.length > 100) return skip('provider_limit');
    return classifyRenewalState({ userId, productId, activeUntil, now, subscriptions, providers, orders });
  } catch {
    return skip('lookup_failed');
  }
}
