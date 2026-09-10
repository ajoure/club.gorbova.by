import { describe, expect, it } from 'vitest';
import { assertRefundAmount, selectRefundPayment } from '../../supabase/functions/_shared/refund-payment-selection';

const payments = ['first', 'second', 'third'].map(id => ({
  id, order_id: 'canonical', provider: 'bepaid', status: 'succeeded',
  provider_payment_id: `provider-${id}`, amount: 663, refunded_amount: 0, currency: 'BYN',
}));

describe('exact installment refund', () => {
  it('selects the third payment independently of response order', () => {
    expect(selectRefundPayment(payments, 'third')?.provider_payment_id).toBe('provider-third');
    expect(selectRefundPayment([...payments].reverse(), 'third')?.id).toBe('third');
  });
  it('requires a choice for multiple refundable payments', () => {
    expect(() => selectRefundPayment(payments)).toThrow('select_exact_payment');
  });
  it('never falls back from an unknown or already-refunded selection', () => {
    expect(() => selectRefundPayment(payments, 'other-order-payment')).toThrow();
    expect(() => selectRefundPayment(payments.map(p => ({...p, refunded_amount:663})), 'third')).toThrow();
  });
  it('retains the single-payment legacy selection', () => {
    expect(selectRefundPayment([payments[0]])?.id).toBe('first');
  });
  it.each([0,-1,664,NaN,Infinity,1.001,'663'])( 'rejects invalid amount %j', amount => {
    expect(() => assertRefundAmount(payments[2],amount,'BYN')).toThrow();
  });
  it('validates remaining balance and currency', () => {
    const payment={...payments[2],refunded_amount:600};
    expect(() => assertRefundAmount(payment,64,'BYN')).toThrow();
    expect(() => assertRefundAmount(payment,63,'EUR')).toThrow();
    expect(() => assertRefundAmount(payment,63,'BYN')).not.toThrow();
  });
});
