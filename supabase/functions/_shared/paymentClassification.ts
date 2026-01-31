/**
 * PATCH 2: Payment Classification System
 * 
 * Classifies payments based on metadata, transaction_type, and amount.
 * This is the single source of truth for payment type determination.
 * 
 * PATCH-1 update: Added amount/currency for 1 BYN card verification rule,
 * added failed_purchase class for failed payments with order.
 */

export type PaymentClassification =
  | 'card_verification'     // void/authorization, or 1 BYN without order
  | 'trial_purchase'        // has_order + is_trial flag
  | 'regular_purchase'      // has_order + succeeded + !is_trial
  | 'subscription_renewal'  // is_recurring=true OR order_number starts with 'REN-'
  | 'refund'                // status=refunded OR transaction_type contains refund
  | 'failed_purchase'       // has_order + failed/declined/error status
  | 'orphan_technical';     // succeeded without order, not matching other categories

export interface PaymentForClassification {
  status: string | null;
  transaction_type: string | null;
  order_id: string | null;
  is_recurring?: boolean | null;
  order_number?: string | null;
  is_trial?: boolean | null;
  description?: string | null;
  meta?: Record<string, any> | null;
  amount?: number | null;
  currency?: string | null;
}

/**
 * Classify payment based on metadata, transaction_type, amount.
 * 
 * Priority order:
 * 0. Failed purchase (has order + failed/declined/error)
 * 1. Refund (status or transaction_type)
 * 2. Card verification (void/authorization without order, OR 1 BYN without order in BYN currency)
 * 3. Subscription renewal (is_recurring or REN- order)
 * 4. Trial purchase (has order + is_trial)
 * 5. Regular purchase (has order + succeeded)
 * 6. Orphan technical (fallback)
 */
export function classifyPayment(payment: PaymentForClassification): PaymentClassification {
  const status = (payment.status || '').toLowerCase();
  const txType = (payment.transaction_type || '').toLowerCase();
  const desc = (payment.description || '').toLowerCase();
  const orderNumber = payment.order_number || '';
  const meta = payment.meta || {};
  const amount = payment.amount !== undefined && payment.amount !== null ? Number(payment.amount) : null;
  const currency = (payment.currency || '').toUpperCase();

  // Priority 0: Failed purchase (has order but failed/declined/error)
  if (
    payment.order_id &&
    (status === 'failed' || status === 'declined' || status === 'error')
  ) {
    return 'failed_purchase';
  }

  // Priority 1: Refund
  if (
    status === 'refunded' ||
    txType.includes('refund') ||
    txType.includes('возврат')
  ) {
    return 'refund';
  }

  // Priority 2: Card verification
  // 2a. By transaction_type (void/authorization without order)
  if (
    (txType.includes('void') || txType.includes('authorization')) &&
    !payment.order_id
  ) {
    return 'card_verification';
  }
  // 2b. By description
  if (
    desc.includes('проверка карты') ||
    desc.includes('card verification') ||
    desc.includes('проверка карты для автоплатежей')
  ) {
    return 'card_verification';
  }
  // 2c. By meta flags
  if (meta.is_card_verification === true || meta.is_verification === true) {
    return 'card_verification';
  }
  // 2d. By amount: 1 BYN (or less) without order in BYN currency = card verification
  if (
    amount !== null &&
    amount <= 1 &&
    currency === 'BYN' &&
    !payment.order_id &&
    status === 'succeeded'
  ) {
    return 'card_verification';
  }

  // Priority 3: Subscription renewal
  if (
    payment.is_recurring === true ||
    orderNumber.startsWith('REN-') ||
    meta.is_renewal === true ||
    meta.is_recurring_charge === true
  ) {
    return 'subscription_renewal';
  }

  // Priority 4: Trial purchase
  if (payment.order_id && payment.is_trial === true) {
    return 'trial_purchase';
  }
  // Check meta for trial flags
  if (payment.order_id && meta.is_trial === true) {
    return 'trial_purchase';
  }

  // Priority 5: Regular purchase (has order + succeeded)
  if (payment.order_id && status === 'succeeded') {
    return 'regular_purchase';
  }

  // Fallback: orphan technical
  return 'orphan_technical';
}

/**
 * Get human-readable label for classification
 */
export function getClassificationLabel(classification: PaymentClassification): string {
  const labels: Record<PaymentClassification, string> = {
    card_verification: 'Проверка карты',
    trial_purchase: 'Триальная покупка',
    regular_purchase: 'Обычная покупка',
    subscription_renewal: 'Продление подписки',
    refund: 'Возврат',
    failed_purchase: 'Неуспешная покупка',
    orphan_technical: 'Техническая операция',
  };
  return labels[classification] || classification;
}

/**
 * Check if classification represents a business event (creates deal/entitlement)
 */
export function isBusinessEvent(classification: PaymentClassification): boolean {
  return ['trial_purchase', 'regular_purchase', 'subscription_renewal'].includes(classification);
}
