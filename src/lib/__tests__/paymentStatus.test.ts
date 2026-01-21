import { describe, it, expect } from 'vitest';
import { 
  toCanonicalStatus, 
  isCanonicalStatus, 
  requireCanonicalStatus,
  isRefundTransactionType,
  isCancelTransactionType,
  isPaymentTransactionType,
  CANONICAL_STATUSES,
  type CanonicalStatus
} from '../paymentStatus';

describe('paymentStatus', () => {
  describe('CANONICAL_STATUSES', () => {
    it('should contain exactly 5 canonical statuses', () => {
      expect(CANONICAL_STATUSES).toHaveLength(5);
      expect(CANONICAL_STATUSES).toContain('succeeded');
      expect(CANONICAL_STATUSES).toContain('refunded');
      expect(CANONICAL_STATUSES).toContain('canceled');
      expect(CANONICAL_STATUSES).toContain('failed');
      expect(CANONICAL_STATUSES).toContain('pending');
    });
  });

  describe('toCanonicalStatus', () => {
    // SUCCESS variations
    it('should map "successful" to "succeeded"', () => {
      expect(toCanonicalStatus('successful')).toBe('succeeded');
    });
    
    it('should map "succeeded" to "succeeded"', () => {
      expect(toCanonicalStatus('succeeded')).toBe('succeeded');
    });
    
    it('should map "success" to "succeeded"', () => {
      expect(toCanonicalStatus('success')).toBe('succeeded');
    });
    
    it('should map Russian "успешно" to "succeeded"', () => {
      expect(toCanonicalStatus('успешно')).toBe('succeeded');
    });
    
    it('should map "completed" to "succeeded"', () => {
      expect(toCanonicalStatus('completed')).toBe('succeeded');
    });
    
    it('should map "processed" to "succeeded"', () => {
      expect(toCanonicalStatus('processed')).toBe('succeeded');
    });
    
    it('should map "captured" to "succeeded"', () => {
      expect(toCanonicalStatus('captured')).toBe('succeeded');
    });

    // REFUND variations
    it('should map "refund" to "refunded"', () => {
      expect(toCanonicalStatus('refund')).toBe('refunded');
    });
    
    it('should map "refunded" to "refunded"', () => {
      expect(toCanonicalStatus('refunded')).toBe('refunded');
    });
    
    it('should map Russian "возврат" to "refunded"', () => {
      expect(toCanonicalStatus('возврат')).toBe('refunded');
    });
    
    it('should map Russian "возврат средств" to "refunded"', () => {
      expect(toCanonicalStatus('возврат средств')).toBe('refunded');
    });

    // CANCEL variations
    it('should map "cancel" to "canceled"', () => {
      expect(toCanonicalStatus('cancel')).toBe('canceled');
    });
    
    it('should map "cancelled" to "canceled"', () => {
      expect(toCanonicalStatus('cancelled')).toBe('canceled');
    });
    
    it('should map "void" to "canceled"', () => {
      expect(toCanonicalStatus('void')).toBe('canceled');
    });
    
    it('should map "voided" to "canceled"', () => {
      expect(toCanonicalStatus('voided')).toBe('canceled');
    });
    
    it('should map "authorization_void" to "canceled"', () => {
      expect(toCanonicalStatus('authorization_void')).toBe('canceled');
    });
    
    it('should map Russian "отмена" to "canceled"', () => {
      expect(toCanonicalStatus('отмена')).toBe('canceled');
    });

    // FAILED variations
    it('should map "failed" to "failed"', () => {
      expect(toCanonicalStatus('failed')).toBe('failed');
    });
    
    it('should map "declined" to "failed"', () => {
      expect(toCanonicalStatus('declined')).toBe('failed');
    });
    
    it('should map "expired" to "failed"', () => {
      expect(toCanonicalStatus('expired')).toBe('failed');
    });
    
    it('should map "incomplete" to "failed"', () => {
      expect(toCanonicalStatus('incomplete')).toBe('failed');
    });
    
    it('should map "error" to "failed"', () => {
      expect(toCanonicalStatus('error')).toBe('failed');
    });
    
    it('should map Russian "ошибка" to "failed"', () => {
      expect(toCanonicalStatus('ошибка')).toBe('failed');
    });

    // PENDING variations
    it('should map "pending" to "pending"', () => {
      expect(toCanonicalStatus('pending')).toBe('pending');
    });
    
    it('should map "processing" to "pending"', () => {
      expect(toCanonicalStatus('processing')).toBe('pending');
    });
    
    it('should map Russian "ожидание" to "pending"', () => {
      expect(toCanonicalStatus('ожидание')).toBe('pending');
    });

    // Edge cases
    it('should handle case-insensitive input', () => {
      expect(toCanonicalStatus('SUCCESSFUL')).toBe('succeeded');
      expect(toCanonicalStatus('Refunded')).toBe('refunded');
      expect(toCanonicalStatus('CANCELLED')).toBe('canceled');
    });
    
    it('should trim whitespace', () => {
      expect(toCanonicalStatus('  successful  ')).toBe('succeeded');
      expect(toCanonicalStatus('\trefunded\n')).toBe('refunded');
    });
    
    it('should return null for unknown status', () => {
      expect(toCanonicalStatus('unknown')).toBeNull();
      expect(toCanonicalStatus('garbage')).toBeNull();
    });
    
    it('should return null for empty/null input', () => {
      expect(toCanonicalStatus('')).toBeNull();
      expect(toCanonicalStatus(null)).toBeNull();
      expect(toCanonicalStatus(undefined)).toBeNull();
    });

    // Partial match fallbacks
    it('should match partial "возврат_частичный" to "refunded"', () => {
      expect(toCanonicalStatus('возврат_частичный')).toBe('refunded');
    });
    
    it('should match partial "successful_payment" via includes', () => {
      expect(toCanonicalStatus('my_successful_payment')).toBe('succeeded');
    });
  });

  describe('isCanonicalStatus', () => {
    it('should return true for canonical statuses', () => {
      expect(isCanonicalStatus('succeeded')).toBe(true);
      expect(isCanonicalStatus('refunded')).toBe(true);
      expect(isCanonicalStatus('canceled')).toBe(true);
      expect(isCanonicalStatus('failed')).toBe(true);
      expect(isCanonicalStatus('pending')).toBe(true);
    });
    
    it('should return false for non-canonical statuses', () => {
      expect(isCanonicalStatus('successful')).toBe(false);
      expect(isCanonicalStatus('refund')).toBe(false);
      expect(isCanonicalStatus('cancelled')).toBe(false);
      expect(isCanonicalStatus('void')).toBe(false);
    });
    
    it('should return false for null/undefined', () => {
      expect(isCanonicalStatus(null)).toBe(false);
      expect(isCanonicalStatus(undefined)).toBe(false);
    });
  });

  describe('requireCanonicalStatus', () => {
    it('should return canonical status for valid input', () => {
      expect(requireCanonicalStatus('successful')).toBe('succeeded');
      expect(requireCanonicalStatus('refund')).toBe('refunded');
    });
    
    it('should throw for invalid input', () => {
      expect(() => requireCanonicalStatus('garbage')).toThrow();
      expect(() => requireCanonicalStatus('unknown')).toThrow();
    });
    
    it('should include context in error message', () => {
      expect(() => requireCanonicalStatus('garbage', 'CSV import'))
        .toThrow(/CSV import/);
    });
  });

  describe('isRefundTransactionType', () => {
    it('should return true for refund types', () => {
      expect(isRefundTransactionType('Возврат средств')).toBe(true);
      expect(isRefundTransactionType('refund')).toBe(true);
      expect(isRefundTransactionType('Refunded')).toBe(true);
      expect(isRefundTransactionType('partial_refund')).toBe(true);
    });
    
    it('should return false for non-refund types', () => {
      expect(isRefundTransactionType('Платеж')).toBe(false);
      expect(isRefundTransactionType('payment')).toBe(false);
      expect(isRefundTransactionType('void')).toBe(false);
      expect(isRefundTransactionType(null)).toBe(false);
      expect(isRefundTransactionType(undefined)).toBe(false);
    });
  });

  describe('isCancelTransactionType', () => {
    it('should return true for cancel/void types', () => {
      expect(isCancelTransactionType('Отмена')).toBe(true);
      expect(isCancelTransactionType('отменa')).toBe(true);
      expect(isCancelTransactionType('void')).toBe(true);
      expect(isCancelTransactionType('authorization_void')).toBe(true);
      expect(isCancelTransactionType('cancel')).toBe(true);
      expect(isCancelTransactionType('cancellation')).toBe(true);
    });
    
    it('should return false for non-cancel types', () => {
      expect(isCancelTransactionType('Платеж')).toBe(false);
      expect(isCancelTransactionType('refund')).toBe(false);
      expect(isCancelTransactionType(null)).toBe(false);
    });
  });

  describe('isPaymentTransactionType', () => {
    it('should return true for payment types', () => {
      expect(isPaymentTransactionType('Платеж')).toBe(true);
      expect(isPaymentTransactionType('payment')).toBe(true);
      expect(isPaymentTransactionType('payment_card')).toBe(true);
      expect(isPaymentTransactionType('payment_erip')).toBe(true);
      expect(isPaymentTransactionType('erip')).toBe(true);
    });
    
    it('should return true for null/undefined (default is payment)', () => {
      expect(isPaymentTransactionType(null)).toBe(true);
      expect(isPaymentTransactionType(undefined)).toBe(true);
    });
    
    it('should return false for non-payment types', () => {
      expect(isPaymentTransactionType('refund')).toBe(false);
      expect(isPaymentTransactionType('void')).toBe(false);
    });
  });
});
