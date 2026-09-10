export type RefundPayment = {
  id: string;
  order_id?: string | null;
  status: string;
  provider?: string | null;
  provider_payment_id?: string | null;
  transaction_type?: string | null;
  amount: number | string;
  refunded_amount?: number | string | null;
  currency?: string;
  is_deleted?: boolean | null;
  paid_at?: string | null;
  created_at?: string;
};

export function isRefundablePayment(p: RefundPayment): boolean {
  return p.status === 'succeeded' && !!p.provider_payment_id &&
    !/refund|возврат/i.test(p.transaction_type || '') && !p.is_deleted &&
    Number.isFinite(Number(p.amount)) && Number.isFinite(Number(p.refunded_amount || 0)) &&
    Number(p.amount) > Number(p.refunded_amount || 0);
}

/** Never turn a requested payment into another successful payment of the order. */
export function selectRefundPayment(payments: RefundPayment[], paymentId?: string | null) {
  const eligible = payments.filter(isRefundablePayment);
  if (paymentId) {
    const payment = eligible.find(p => p.id === paymentId);
    if (!payment) throw new Error('selected_payment_not_refundable');
    return payment;
  }
  if (eligible.length > 1) throw new Error('select_exact_payment_for_refund');
  return eligible[0] ?? null;
}

export function assertRefundAmount(payment: RefundPayment, amount: unknown, currency: string) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 ||
      Math.round(amount * 100) > Math.round((Number(payment.amount) - Number(payment.refunded_amount || 0)) * 100) ||
      (payment.currency && payment.currency !== currency)) {
    throw new Error('invalid_payment_refund_amount');
  }
}
