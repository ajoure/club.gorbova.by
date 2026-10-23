import { describe, expect, it } from 'vitest';
import { latestSubscriptionPayment, type SubscriptionOrderRow, type SubscriptionPaymentContext } from './latestSubscriptionPayment';

const subscription: SubscriptionPaymentContext = {
  user_id: 'owner', product_id: 'club', tariff_id: 'business', order_id: 'january',
  meta: { bepaid_subscription_id: 'sbs-current' },
};
function order(id: string, paidAt: string, patch: Partial<SubscriptionOrderRow> = {}): SubscriptionOrderRow {
  return {
    id, user_id: 'owner', product_id: 'club', tariff_id: 'business', status: 'paid', final_price: 250,
    bepaid_subscription_id: 'sbs-current', meta: {},
    payments_v2: [{ id: `pay-${id}`, amount: 250, status: 'succeeded', provider: 'bepaid', paid_at: paidAt }],
    ...patch,
  };
}
const january = order('january', '2026-01-18T06:00:00Z');
const october = order('october', '2026-10-13T06:00:00Z');
const resolve = (orders: SubscriptionOrderRow[], sub = subscription) => latestSubscriptionPayment('owner', sub, orders);

describe('latestSubscriptionPayment', () => {
  it('selects the renewal and its payment instead of the creation order, independent of query order', () => {
    for (const orders of [[january, october], [october, january]]) {
      const result = resolve(orders);
      expect(result?.order.id).toBe('october');
      expect(result?.payment.id).toBe('pay-october');
    }
  });
  it.each([
    { user_id: 'other' }, { product_id: 'other' }, { tariff_id: 'other' },
    { status: 'refunded' }, { status: 'canceled' }, { status: 'failed' }, { final_price: 0 },
    { bepaid_subscription_id: 'sbs-foreign', meta: { parent_order_id: 'january', source: 'bepaid_rebill' } },
    { bepaid_subscription_id: null, meta: {} },
  ])('does not attach another or unpaid order: %j', patch => {
    expect(resolve([january, { ...october, ...patch }])?.order.id).toBe('january');
  });
  it.each(['admin', 'admin_test', 'manual', 'virtual', 'unknown'])('rejects %s payment', provider => {
    expect(resolve([january, { ...october, payments_v2: [{ ...october.payments_v2[0], provider }] }])?.order.id).toBe('january');
  });
  it.each([
    { amount: 0 }, { amount: -250 }, { status: 'failed' }, { status: 'refunded' },
    { paid_at: null }, { paid_at: 'not-a-date' }, { meta: { bepaid_subscription_id: 'sbs-foreign' } },
    { meta: { is_test: true } }, { meta: { test_payment: 'true' } },
  ])('rejects an unproven, refunded or foreign payment: %j', patch => {
    expect(resolve([january, { ...october, payments_v2: [{ ...october.payments_v2[0], ...patch }] }])?.order.id).toBe('january');
  });
  it('rejects an order with a separate refund even when its original payment still succeeded', () => {
    const refunded = { ...october, payments_v2: [...october.payments_v2,
      { ...october.payments_v2[0], id: 'refund', status: 'refunded', amount: -250 }] };
    expect(resolve([january, refunded])?.order.id).toBe('january');
  });
  it('uses exact server rebill lineage when the order lacks a provider subscription ID', () => {
    const renewal = { ...october, bepaid_subscription_id: null,
      meta: { parent_order_id: 'january', source: 'bepaid_rebill' } };
    expect(resolve([january, renewal])?.order.id).toBe('october');
    expect(resolve([january, { ...renewal, meta: { parent_order_id: 'january' } }])?.order.id).toBe('january');
  });
  it('cannot infer membership just from the same product/tariff, even without provider metadata', () => {
    const sub = { ...subscription, meta: null };
    const root = { ...january, bepaid_subscription_id: null };
    expect(resolve([root, { ...october, bepaid_subscription_id: null }], sub)?.order.id).toBe('january');
    expect(resolve([root, { ...october, bepaid_subscription_id: 'unbound' }], sub)?.order.id).toBe('january');
  });
  it('excludes a test order even with a real-provider succeeded row', () => {
    expect(resolve([january, { ...october, meta: { test_payment_direct: true } }])?.order.id).toBe('january');
  });
  it('fails closed on missing/error data, owner mismatch, or ambiguous paid timestamps', () => {
    expect(latestSubscriptionPayment('owner', subscription, undefined)).toBeNull();
    expect(latestSubscriptionPayment('other', subscription, [october])).toBeNull();
    expect(resolve([october, order('different-order', october.payments_v2[0].paid_at!)])).toBeNull();
    expect(resolve([october, january], { ...subscription, user_id: 'other' })).toBeNull();
    expect(resolve([order('january', '2026-01-18', { status: 'pending' })])).toBeNull();
  });
  it('preserves a real paid root for a non-bePaid subscription without borrowing another order', () => {
    const stripeRoot = { ...january, bepaid_subscription_id: null,
      payments_v2: [{ ...january.payments_v2[0], provider: 'stripe' }] };
    expect(resolve([stripeRoot, october], { ...subscription, meta: null })?.order.id).toBe('january');
  });
});
