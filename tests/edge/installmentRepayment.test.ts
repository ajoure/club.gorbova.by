import { describe, expect, it } from 'vitest';
import { isInstallmentIntent, moneyMinor, repaymentBalance, splitRemainingDebt } from '../../supabase/functions/_shared/installment-repayment-plan';
import { quoteInstallmentRepayment } from '../../supabase/functions/_shared/installment-repayment-context';

const payment = { id: 'p1', order_id: 'order', user_id: 'user', currency: 'BYN', provider: 'bepaid',
  provider_payment_id: 'uid-1', status: 'succeeded', amount: 442, refunded_amount: 0 };
const balance = (payments = [payment], total = 1326) => repaymentBalance({ orderId: 'order', userId: 'user', currency: 'BYN', total, payments });

describe('existing installment repayment, no new purchase', () => {
  it('keeps the original agreement and splits 884 into two 442 payments', () => {
    expect(balance()).toEqual({ totalMinor: 132600, paidMinor: 44200, remainingMinor: 88400, paidCount: 1 });
    expect(splitRemainingDebt(balance().remainingMinor, 2)).toEqual([44200, 44200]);
  });
  it('can add a month without increasing the debt by rounding', () => {
    expect(splitRemainingDebt(88400, 3)).toEqual([29467, 29467, 29466]);
  });
  it('can settle the entire remaining debt in one payment', () => expect(splitRemainingDebt(88400, 1)).toEqual([88400]));
  it('deduplicates provider uid and rejects conflicting duplicate amounts', () => {
    expect(balance([payment, { ...payment, id: 'p2' }]).paidMinor).toBe(44200);
    expect(() => balance([payment, { ...payment, id: 'p2', amount: 443 }])).toThrow('conflicting_payment_duplicate');
  });
  it.each([{ order_id: 'other' }, { user_id: 'other' }, { currency: 'EUR' }])('rejects foreign payment %j', patch => {
    expect(() => balance([{ ...payment, ...patch }])).toThrow('payment_identity_mismatch');
  });
  it.each([{ refunded_amount: 1 }, { status: 'refunded' }, { status: 'partially_refunded' }])('does not re-charge refunded money %j', patch => {
    expect(() => balance([{ ...payment, ...patch }])).toThrow('refunded_installment_requires_review');
  });
  it('does not count failures or soft-deleted rows as paid', () => {
    expect(() => balance([{ ...payment, status: 'failed' }])).toThrow('installment_has_no_payment');
    expect(repaymentBalance({ orderId: 'order', userId: 'user', currency: 'BYN', total: 1326,
      payments: [payment, { ...payment, id: 'p2', provider_payment_id: 'uid-2', is_deleted: true }] }).paidCount).toBe(1);
  });
  it('detects completed and overpaid agreements', () => {
    expect(balance([payment], 442).remainingMinor).toBe(0);
    expect(() => balance([payment], 400)).toThrow('installment_overpaid');
  });
  it.each([NaN, Infinity, -1, 1.001, null, '', true, {}])('rejects invalid money %s', n => expect(() => moneyMinor(n)).toThrow('invalid_money'));
  it.each([0, -1, 1.5, 61])('rejects invalid count %s', n => expect(() => splitRemainingDebt(88400, n)).toThrow('invalid_repayment_count'));
  it('blocks sub-minimum charges', () => expect(() => splitRemainingDebt(100, 2)).toThrow('repayment_below_minimum'));
  it('detects legacy and canonical intent before a generic subscription can be created', () => {
    expect(isInstallmentIntent({ installment_count: 3 })).toBe(true);
    expect(isInstallmentIntent({ installment: { model: 'bepaid_finite_subscription' } })).toBe(true);
    expect(isInstallmentIntent({ recurring_amount: 250 })).toBe(false);
  });
});

describe('server-owned repayment quote', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal synthetic context for the pure quote function
  const context: any = { order: { id: 'order', currency: 'BYN' }, sub: { id: 'sub' }, fingerprint: 'version',
    agreement: { per_payment_byn: 442, interval_days: 30 }, balance: balance(), liveProviders: [{ state: 'failed_attempt' }] };
  it('defaults to two remaining payments, retaining the existing purchase and access', () => {
    expect(quoteInstallmentRepayment(context, { payment_type: 'subscription' })).toMatchObject({
      original_order_id: 'order', subscription_v2_id: 'sub', paid_minor: 44200, remaining_minor: 88400,
      schedule_minor: [44200, 44200], interval_days: 30, replaces_live_mandate: true,
      replaces_provider_subscription_id: null, changes_access: false,
    });
  });
  it('offers exact manual three-payment splitting but never an overcharging uniform subscription', () => {
    expect(quoteInstallmentRepayment(context, { count: 3, payment_type: 'one_time' }).schedule_minor).toEqual([29467,29467,29466]);
    expect(() => quoteInstallmentRepayment(context, { count: 3, payment_type: 'subscription' })).toThrow('autopay_requires_equal_remaining_payments');
  });
  it('requires a valid interval and at least two autopay cycles', () => {
    expect(() => quoteInstallmentRepayment(context, { payment_type: 'one_time', interval_days: 0 })).toThrow('invalid_repayment_interval');
    expect(() => quoteInstallmentRepayment(context, { payment_type: 'subscription', count: 1 })).toThrow('autopay_requires_equal_remaining_payments');
  });
});
