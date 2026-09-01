import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { mapOrderToPlan } from './useContactInstallmentsData';

const payment = { id: 'p1', order_id: 'order', user_id: 'user', provider: 'bepaid', provider_payment_id: 'uid-1',
  currency: 'BYN', status: 'succeeded', amount: 442, refunded_amount: 0 };
const order = { id: 'order', user_id: 'user', currency: 'BYN', paid_amount: 442, created_at: '2026-07-31',
  meta: { installment: { model: 'bepaid_finite_subscription', billing_cycles: 3, per_payment_byn: 442, effective_total_byn: 1326 } }, payments_v2: [payment] };

describe('contact installment factual balance', () => {
  it('shows one paid and 884 remaining without cached installment_progress', () => {
    expect(mapOrderToPlan(order)).toMatchObject({ paidCycles: 1, totalCycles: 3, paidTotal: 442, remainingTotal: 884, uiStatus: 'active' });
  });
  it('does not trust a stale provider cycle counter or completed flag', () => {
    expect(mapOrderToPlan({ ...order, meta: { ...order.meta, installment_progress: {
      paid_billing_cycles: 3, paid_total_byn: 2650, effective_total_byn: 2650, per_payment_byn: 2650, remaining_total_byn: 0, status: 'completed' } } }))
      .toMatchObject({ paidTotal: 442, effectiveTotal: 1326, perPayment: 442, remainingTotal: 884, paidCycles: 1, uiStatus: 'active' });
  });
  it('shows paid only when factual unique payments settle the total', () => {
    expect(mapOrderToPlan({ ...order, payments_v2: [payment, { ...payment, id: 'p2', provider_payment_id: 'uid-2', amount: 884 }] }))
      .toMatchObject({ paidTotal: 1326, remainingTotal: 0, uiStatus: 'completed' });
  });
  it('shows a manually extended factual schedule without changing the original debt', () => {
    expect(mapOrderToPlan({ ...order, meta: { ...order.meta, installment_progress: {
      source: 'repayment_factual_ledger', billing_cycles: 4, paid_billing_cycles: 2,
      per_payment_byn: 294.67, effective_total_byn: 1326, status: 'active',
    } } })).toMatchObject({ totalCycles: 4, perPayment: 294.67, effectiveTotal: 1326 });
  });
  it('hides unpaid checkout drafts', () => expect(mapOrderToPlan({ ...order, paid_amount: 0, payments_v2: [] })).toBeNull());
  it('does not present cached money or refunded money as collectable', () => {
    expect(mapOrderToPlan({ ...order, payments_v2: [] })).toMatchObject({ paidTotal: NaN, remainingTotal: NaN, uiStatus: 'review' });
    expect(mapOrderToPlan({ ...order, payments_v2: [{ ...payment, refunded_amount: 1 }] })).toMatchObject({ remainingTotal: NaN, uiStatus: 'review' });
  });
});
