/**
 * Centralized payment status and type classification
 * Single source of truth for all payment categorization logic
 */

// Status classifications
export const SUCCESS_STATUSES = ['successful', 'succeeded'] as const;
export const FAILED_STATUSES = ['failed', 'error', 'declined', 'expired', 'incomplete'] as const;
export const PENDING_STATUSES = ['pending', 'processing'] as const;
export const CANCELLED_STATUSES = ['cancelled', 'canceled', 'void'] as const;

// Transaction type classifications
export const PAYMENT_TYPES = [
  'Платеж', 
  'payment', 
  'payment_card', 
  'payment_erip', 
  'payment_apple_pay', 
  'payment_google_pay'
] as const;

export const REFUND_TYPES = [
  'Возврат средств', 
  'refund', 
  'refunded'
] as const;

export const CANCEL_TYPES = [
  'Отмена', 
  'void', 
  'cancellation', 
  'authorization_void',
  'canceled',
  'cancelled'
] as const;

/**
 * Check if a payment status indicates success
 */
export function isSuccessStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return SUCCESS_STATUSES.includes(normalized as typeof SUCCESS_STATUSES[number]);
}

/**
 * Check if a payment status indicates failure
 */
export function isFailedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return FAILED_STATUSES.includes(normalized as typeof FAILED_STATUSES[number]);
}

/**
 * Check if a payment status indicates pending/processing
 */
export function isPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return PENDING_STATUSES.includes(normalized as typeof PENDING_STATUSES[number]);
}

/**
 * Check if a payment is a refund transaction
 */
export function isRefundTransaction(
  transactionType: string | null | undefined,
  status: string | null | undefined,
  amount?: number
): boolean {
  const txType = (transactionType || '').toLowerCase();
  const statusNorm = (status || '').toLowerCase();
  
  // Check by transaction type
  if (REFUND_TYPES.some(rt => txType.includes(rt.toLowerCase()))) {
    return true;
  }
  
  // Check by status
  if (statusNorm === 'refunded') {
    return true;
  }
  
  // Check by negative amount with refund indicators
  if (amount !== undefined && amount < 0 && txType.includes('возврат')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a payment is a cancellation/void transaction
 */
export function isCancelTransaction(
  transactionType: string | null | undefined,
  status: string | null | undefined
): boolean {
  const txType = (transactionType || '').toLowerCase();
  const statusNorm = (status || '').toLowerCase();
  
  // Check by transaction type
  if (CANCEL_TYPES.some(ct => txType.includes(ct.toLowerCase()))) {
    return true;
  }
  
  // Check by status
  if (CANCELLED_STATUSES.includes(statusNorm as typeof CANCELLED_STATUSES[number])) {
    return true;
  }
  
  return false;
}

/**
 * Check if a payment is a regular payment transaction
 */
export function isPaymentTransaction(transactionType: string | null | undefined): boolean {
  if (!transactionType) return false;
  const txType = transactionType.toLowerCase();
  return PAYMENT_TYPES.some(pt => txType.includes(pt.toLowerCase()));
}

/**
 * Classify a payment into a category
 */
export type PaymentCategory = 'successful' | 'refunded' | 'cancelled' | 'failed' | 'pending' | 'unknown';

export function classifyPayment(
  status: string | null | undefined,
  transactionType: string | null | undefined,
  amount?: number
): PaymentCategory {
  // First check for refunds (takes priority)
  if (isRefundTransaction(transactionType, status, amount)) {
    return 'refunded';
  }
  
  // Check for cancellations
  if (isCancelTransaction(transactionType, status)) {
    return 'cancelled';
  }
  
  // Check for pending
  if (isPendingStatus(status)) {
    return 'pending';
  }
  
  // Check for failed
  if (isFailedStatus(status)) {
    return 'failed';
  }
  
  // Check for successful
  if (isSuccessStatus(status) && isPaymentTransaction(transactionType) && (amount === undefined || amount > 0)) {
    return 'successful';
  }
  
  return 'unknown';
}
