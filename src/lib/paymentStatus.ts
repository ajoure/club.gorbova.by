/**
 * Canonical payment status values
 * SINGLE SOURCE OF TRUTH for all payment status normalization
 * 
 * MUST match:
 * - DB constraint: chk_payment_status_canonical
 * - RPC get_payments_stats logic
 * - paymentClassification.ts constants
 */

export type CanonicalStatus = 'succeeded' | 'refunded' | 'canceled' | 'failed' | 'pending';

/**
 * All canonical status values
 */
export const CANONICAL_STATUSES: readonly CanonicalStatus[] = [
  'succeeded',
  'refunded', 
  'canceled',
  'failed',
  'pending'
] as const;

/**
 * Mapping from various status strings to canonical form
 * Covers: Russian, English, common typos, legacy values
 */
const STATUS_MAP: Record<string, CanonicalStatus> = {
  // Success variations → 'succeeded'
  'successful': 'succeeded',
  'succeeded': 'succeeded',
  'success': 'succeeded',
  'успешно': 'succeeded',
  'успех': 'succeeded',
  'successful payment': 'succeeded',
  'completed': 'succeeded',    // ADDED: final state
  'processed': 'succeeded',    // ADDED: final state
  'captured': 'succeeded',     // ADDED: bePaid captured = success
  
  // Refund variations → 'refunded'
  'refund': 'refunded',
  'refunded': 'refunded',
  'refunds': 'refunded',
  'возврат': 'refunded',
  'возврат средств': 'refunded',
  
  // Cancel variations → 'canceled'
  'cancel': 'canceled',
  'cancelled': 'canceled',
  'canceled': 'canceled',
  'void': 'canceled',
  'voided': 'canceled',        // ADDED: bePaid voided
  'отмена': 'canceled',
  'authorization_void': 'canceled',
  'cancellation': 'canceled',
  
  // Failed variations → 'failed'
  'failed': 'failed',
  'fail': 'failed',
  'error': 'failed',
  'declined': 'failed',
  'expired': 'failed',
  'incomplete': 'failed',      // NOTE: incomplete = failed (not pending)
  'ошибка': 'failed',
  'отклонено': 'failed',
  'неуспешно': 'failed',
  
  // Pending variations → 'pending'
  'pending': 'pending',
  'processing': 'pending',
  'ожидание': 'pending',
  'в обработке': 'pending',
};

// ============================================================================
// TRANSACTION TYPE HELPERS
// Centralized logic for detecting refund/cancel/payment transactions
// ============================================================================

/**
 * Transaction type patterns for refunds
 */
const REFUND_TYPE_PATTERNS = [
  'возврат', 'refund', 'refunds', 'refunded'
] as const;

/**
 * Transaction type patterns for cancellations/voids
 */
const CANCEL_TYPE_PATTERNS = [
  'отмена', 'отмен', 'cancel', 'void', 'authorization_void', 'cancellation'
] as const;

/**
 * Transaction type patterns for regular payments
 */
const PAYMENT_TYPE_PATTERNS = [
  'платеж', 'платёж', 'payment', 'payment_card', 'payment_erip', 
  'erip', 'apple_pay', 'google_pay'
] as const;

/**
 * Check if transaction type indicates a refund
 */
export function isRefundTransactionType(transactionType: string | null | undefined): boolean {
  if (!transactionType) return false;
  const lower = transactionType.toLowerCase();
  return REFUND_TYPE_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if transaction type indicates a cancellation/void
 */
export function isCancelTransactionType(transactionType: string | null | undefined): boolean {
  if (!transactionType) return false;
  const lower = transactionType.toLowerCase();
  return CANCEL_TYPE_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if transaction type indicates a regular payment
 */
export function isPaymentTransactionType(transactionType: string | null | undefined): boolean {
  if (!transactionType) return true; // Default to payment if no type
  const lower = transactionType.toLowerCase();
  return PAYMENT_TYPE_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Convert any status string to canonical form
 * 
 * @param input - Raw status string from CSV, API, or user input
 * @returns CanonicalStatus or null if unrecognized
 * 
 * @example
 * toCanonicalStatus('refund') // → 'refunded'
 * toCanonicalStatus('successful') // → 'succeeded'
 * toCanonicalStatus('unknown') // → null
 */
export function toCanonicalStatus(input: string | null | undefined): CanonicalStatus | null {
  if (!input) return null;
  
  const normalized = input.toLowerCase().trim();
  
  // Direct lookup
  if (STATUS_MAP[normalized]) {
    return STATUS_MAP[normalized];
  }
  
  // Partial match fallbacks for edge cases
  if (normalized.includes('возврат') || normalized.includes('refund')) {
    return 'refunded';
  }
  if (normalized.includes('отмен') || normalized.includes('void')) {
    return 'canceled';
  }
  if (normalized.includes('успеш') || normalized.includes('success')) {
    return 'succeeded';
  }
  if (normalized.includes('ошибк') || normalized.includes('fail') || normalized.includes('decline')) {
    return 'failed';
  }
  if (normalized.includes('pending') || normalized.includes('process')) {
    return 'pending';
  }
  
  return null;
}

/**
 * Check if a status string is already in canonical form
 */
export function isCanonicalStatus(status: string | null | undefined): status is CanonicalStatus {
  if (!status) return false;
  return CANONICAL_STATUSES.includes(status as CanonicalStatus);
}

/**
 * Ensure status is canonical, throwing if conversion fails
 * Use when you MUST have a valid status (e.g., before DB write)
 */
export function requireCanonicalStatus(input: string, context?: string): CanonicalStatus {
  const canonical = toCanonicalStatus(input);
  if (!canonical) {
    throw new Error(
      `Invalid status "${input}"${context ? ` in ${context}` : ''}. ` +
      `Must be one of: ${CANONICAL_STATUSES.join(', ')}`
    );
  }
  return canonical;
}
