/** Read-only selection of a paid order belonging to one exact subscription.
 * The creation order is lineage, not the latest renewal. Never match by name
 * or product alone, and never fall back to stale joined data on a query error.
 */
export interface SubscriptionPaymentContext {
  user_id: string;
  product_id: string;
  tariff_id: string | null;
  order_id: string | null;
  meta: Record<string, unknown> | null;
}

export interface SubscriptionPaymentRow {
  id: string;
  status: string;
  provider: string | null;
  amount: number;
  paid_at: string | null;
  meta?: Record<string, unknown> | null;
}

export interface SubscriptionOrderRow<P extends SubscriptionPaymentRow = SubscriptionPaymentRow> {
  id: string;
  user_id: string;
  product_id: string | null;
  tariff_id: string | null;
  status: string;
  final_price: number;
  bepaid_subscription_id: string | null;
  meta: Record<string, unknown> | null;
  payments_v2: P[];
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function latestSubscriptionPayment<O extends SubscriptionOrderRow>(
  userId: string | null | undefined,
  subscription: SubscriptionPaymentContext | null,
  orders: readonly O[] | null | undefined,
): { order: O; payment: O['payments_v2'][number] } | null {
  if (!userId || !subscription || !subscription.product_id || subscription.user_id !== userId || !orders) return null;
  const rootId = subscription.order_id;
  const root = orders.find(order => order.id === rootId && order.user_id === userId
    && order.product_id === subscription.product_id && order.tariff_id === subscription.tariff_id);
  const providerId = nonEmpty(subscription.meta?.bepaid_subscription_id)
    || nonEmpty(root?.bepaid_subscription_id);
  const candidates: Array<{ order: O; payment: O['payments_v2'][number]; paidAt: number }> = [];

  for (const order of orders) {
    if (order.user_id !== userId || order.product_id !== subscription.product_id
      || order.tariff_id !== subscription.tariff_id || order.status !== 'paid' || !(order.final_price > 0)) continue;
    const orderProviderId = nonEmpty(order.bepaid_subscription_id);
    // A contradictory provider ID must never be rescued by parent_order_id.
    if (providerId && orderProviderId && orderProviderId !== providerId) continue;
    const isRoot = !!rootId && order.id === rootId;
    const exactProvider = !!providerId && orderProviderId === providerId;
    const exactLineage = !!rootId && order.meta?.parent_order_id === rootId
      && order.meta?.source === 'bepaid_rebill'
      && (!orderProviderId || (!!providerId && orderProviderId === providerId));
    if (!isRoot && !exactProvider && !exactLineage) continue;
    // A refund record can coexist with the original succeeded payment.
    if (order.payments_v2.some(payment => payment.amount < 0 || payment.status === 'refunded')) continue;
    for (const payment of order.payments_v2) {
      if (payment.status !== 'succeeded' || !(payment.amount > 0)
        || !['bepaid', 'stripe'].includes(payment.provider || '')) continue;
      const testMeta = [order.meta, payment.meta];
      if (testMeta.some(meta => ['test_payment', 'test_payment_direct', 'is_test'].some(key =>
        meta?.[key] === true || meta?.[key] === 'true') || meta?.source === 'test_payment')) continue;
      const paymentProviderId = nonEmpty(payment.meta?.bepaid_subscription_id);
      if (providerId && paymentProviderId && paymentProviderId !== providerId) continue;
      const paidAt = payment.paid_at ? Date.parse(payment.paid_at) : NaN;
      if (!Number.isFinite(paidAt)) continue;
      candidates.push({ order, payment, paidAt });
    }
  }
  candidates.sort((a, b) => b.paidAt - a.paidAt);
  const latest = candidates[0];
  // Equal timestamps on different orders/payments are ambiguous, not a reason
  // to pick whichever record happened to arrive first from PostgREST.
  if (!latest || candidates.some(candidate => candidate !== latest
    && candidate.paidAt === latest.paidAt
    && (candidate.order.id !== latest.order.id || candidate.payment.id !== latest.payment.id))) return null;
  return { order: latest.order, payment: latest.payment };
}
