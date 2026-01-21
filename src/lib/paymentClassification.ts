/**
 * Centralized payment status and type classification
 * Single source of truth for all payment categorization logic
 * 
 * MUST MATCH RPC: get_payments_stats exactly!
 */

// Status classifications
export const SUCCESS_STATUSES = ['successful', 'succeeded'] as const;
export const FAILED_STATUSES = ['failed', 'error', 'declined', 'expired', 'incomplete'] as const;
export const PENDING_STATUSES = ['pending', 'processing'] as const;
export const CANCELLED_STATUSES = ['cancelled', 'canceled', 'void'] as const;

// Transaction type classifications - MUST match RPC exactly
export const PAYMENT_TYPES = [
  'платеж', 
  'payment', 
  'payment_card', 
  'payment_erip',
  'erip', // Add standalone ERIP
  'payment_apple_pay', 
  'payment_google_pay'
] as const;

export const REFUND_TYPES = [
  'возврат средств', 
  'refund', 
  'refunded'
] as const;

export const CANCEL_TYPES = [
  'отмена', 
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
 * Priority 1 in classification
 */
export function isRefundTransaction(
  transactionType: string | null | undefined,
  status: string | null | undefined,
  amount?: number
): boolean {
  const txType = (transactionType || '').toLowerCase();
  const statusNorm = (status || '').toLowerCase();
  
  // Check by transaction type - includes partial match
  if (REFUND_TYPES.some(rt => txType.includes(rt.toLowerCase()))) {
    return true;
  }
  
  // Check by status = 'refunded'
  if (statusNorm === 'refunded') {
    return true;
  }
  
  // Negative amount with refund keyword
  if (amount !== undefined && amount < 0 && txType.includes('возврат')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a payment is a cancellation/void transaction
 * Priority 2 in classification (after refund check)
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
 * Required for successful classification
 */
export function isPaymentTransaction(transactionType: string | null | undefined): boolean {
  if (!transactionType) return false;
  const txType = transactionType.toLowerCase();
  // Must match one of payment types
  return PAYMENT_TYPES.some(pt => txType.includes(pt.toLowerCase()));
}

/**
 * Classify a payment into a category
 * 
 * Priority order (MUST match RPC):
 * 1. refund - if isRefundTransaction
 * 2. cancelled - if isCancelTransaction (and NOT refund)
 * 3. pending - if isPendingStatus
 * 4. failed - if isFailedStatus (and NOT refund/cancel - already returned)
 * 5. successful - if isSuccessStatus AND isPaymentTransaction AND amount > 0
 * 6. unknown - fallback
 */
export type PaymentCategory = 'successful' | 'refunded' | 'cancelled' | 'failed' | 'pending' | 'unknown';

export function classifyPayment(
  status: string | null | undefined,
  transactionType: string | null | undefined,
  amount?: number
): PaymentCategory {
  // Priority 1: Refund (ALWAYS check first)
  if (isRefundTransaction(transactionType, status, amount)) {
    return 'refunded';
  }
  
  // Priority 2: Cancellation/void (refunds already returned)
  if (isCancelTransaction(transactionType, status)) {
    return 'cancelled';
  }
  
  // Priority 3: Pending
  if (isPendingStatus(status)) {
    return 'pending';
  }
  
  // Priority 4: Failed (refunds/cancels already returned)
  if (isFailedStatus(status)) {
    return 'failed';
  }
  
  // Priority 5: Successful
  // CRITICAL: Must match RPC logic exactly:
  // - status IN (successful, succeeded)
  // - transaction_type must be payment type
  // - amount > 0
  if (
    isSuccessStatus(status) && 
    isPaymentTransaction(transactionType) && 
    (amount === undefined || amount > 0)
  ) {
    return 'successful';
  }
  
  return 'unknown';
}
