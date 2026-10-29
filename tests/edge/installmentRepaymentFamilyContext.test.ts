import { describe, expect, it } from 'vitest';
import { loadInstallmentRepaymentContext, quoteInstallmentRepayment } from '../../supabase/functions/_shared/installment-repayment-context';

const orderId = '00000000-0000-4000-8000-000000000001';
const agreement = { model: 'bepaid_finite_subscription', infinite: false, original_order_id: orderId,
  billing_cycles: 6, per_payment_byn: 339, effective_total_byn: 2034 };
const payment = (id: string, order_id: string) => ({ id, order_id, user_id: 'buyer', currency: 'BYN',
  provider: 'bepaid', provider_payment_id: id, status: 'succeeded', amount: 339, refunded_amount: 0, updated_at: '2026-10-22' });
const root = { id: orderId, user_id: 'buyer', product_id: 'course', tariff_id: 'tier', currency: 'BYN',
  status: 'paid', meta: { installment: agreement }, updated_at: '2026-07-22', bepaid_subscription_id: 'bank-plan',
  payments_v2: [payment('july', orderId), payment('august', orderId)] };
const rebill = (id: string) => ({ ...root, id,
  meta: { parent_order_id: orderId, source: 'bepaid_rebill', payment_flow: 'bepaid_subscription_charge', materialized_from_payment_uid: id },
  payments_v2: [payment(id, id)] });

function database(rows = [root, rebill('september'), rebill('october')]) {
  return { from(table: string) {
    const filters = new Map<string, unknown>();
    const inFilters = new Map<string, unknown[]>();
    const data = () => table === 'orders_v2' ? rows.filter(row => {
      for (const [key, value] of filters) if ((row as Record<string, unknown>)[key] !== value) return false;
      for (const [key, values] of inFilters) {
        const value = key === 'meta->>parent_order_id' ? (row.meta as Record<string, unknown>).parent_order_id : (row as Record<string, unknown>)[key];
        if (!values.includes(value)) return false;
      }
      return true;
    })
      : table === 'subscriptions_v2' ? [{ id: 'sub', order_id: orderId, user_id: 'buyer', product_id: 'course', tariff_id: 'tier',
        meta: { installment: agreement }, updated_at: '2026-07-22' }]
      : table === 'provider_subscriptions' ? [{ id: 'provider', provider: 'bepaid', provider_subscription_id: 'bank-plan',
        subscription_v2_id: 'sub', order_id: orderId, user_id: 'buyer', state: 'active', updated_at: '2026-10-22' }] : [];
    const builder = { select() { return this; }, eq(key: string, value: unknown) { filters.set(key, value); return this; },
      in(key: string, values: unknown[]) { inFilters.set(key, values); return this; },
      maybeSingle() { return Promise.resolve({ data: rows.find(row => row.id === filters.get('id')), error: null }); },
      limit() { return Promise.resolve({ data: data(), error: null }); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: data(), error: null }).then(resolve); } };
    return builder;
  } };
}

describe('repayment quote after receipt materialization', () => {
  it('quotes only the actual remainder after all four receipts across three deals', async () => {
    const context = await loadInstallmentRepaymentContext(database() as never, orderId);
    expect(context.balance).toMatchObject({ paidCount: 4, paidMinor: 135600, remainingMinor: 67800 });
    expect(quoteInstallmentRepayment(context, { payment_type: 'one_time', count: 1 }))
      .toMatchObject({ paid_minor: 135600, remaining_minor: 67800, schedule_minor: [67800], changes_access: false });
  });
  it('keeps manual review as a hard gate before creating a repayment quote', async () => {
    const disputed = { ...root, meta: { ...root.meta, manual_review: true } };
    await expect(loadInstallmentRepaymentContext(database([disputed, rebill('september')]) as never, orderId))
      .rejects.toThrow('installment_agreement_requires_review');
  });
  it.each(['user_id', 'product_id', 'tariff_id', 'currency', 'bepaid_subscription_id'])(
    'rejects a child re-bound by %s instead of quoting only the parent', async field => {
    const foreign = { ...rebill('september'), [field]: 'foreign' };
    await expect(loadInstallmentRepaymentContext(database([root, foreign]) as never, orderId))
      .rejects.toThrow(/installment_family_(identity_mismatch|lineage_unproven)/);
  });
});
