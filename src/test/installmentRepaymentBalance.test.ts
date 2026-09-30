import { describe, expect, it } from 'vitest';
import { repaymentBalance, RepaymentPlanError, type RepaymentPayment } from '../../supabase/functions/_shared/installment-repayment-plan';

const payment = (id: string, transaction_type: string): RepaymentPayment => ({
  id, order_id: 'order-1', user_id: 'user-1', currency: 'BYN', provider: 'bepaid',
  provider_payment_id: id, status: 'succeeded', amount: 442, transaction_type,
});

describe('repayment balance for imported statement payments', () => {
  it.each(['Платеж', 'Платёж'])('counts %s as a successful charge', type => {
    expect(repaymentBalance({
      orderId: 'order-1', userId: 'user-1', currency: 'BYN', total: 1326,
      payments: [payment('first', 'payment'), payment('second', type)],
    })).toEqual({ totalMinor: 132600, paidMinor: 88400, remainingMinor: 44200, paidCount: 2 });
  });

  it('still blocks a statement refund from being charged again', () => {
    expect(() => repaymentBalance({
      orderId: 'order-1', userId: 'user-1', currency: 'BYN', total: 1326,
      payments: [payment('first', 'payment'), payment('refund', 'Возврат')],
    })).toThrowError(new RepaymentPlanError('payment_type_requires_review'));
  });

  it('deduplicates webhook and statement rows with the same provider payment id', () => {
    const imported = payment('same', ' ПЛАТЕЖ ');
    imported.id = 'statement-row';
    expect(repaymentBalance({
      orderId: 'order-1', userId: 'user-1', currency: 'BYN', total: 1326,
      payments: [payment('same', 'payment'), imported],
    }).paidMinor).toBe(44200);
  });

  it.each(['Отмена', 'void'])('rejects %s', type => {
    expect(() => repaymentBalance({
      orderId: 'order-1', userId: 'user-1', currency: 'BYN', total: 1326,
      payments: [payment('first', 'payment'), payment('other', type)],
    })).toThrowError(new RepaymentPlanError('payment_type_requires_review'));
  });
});
