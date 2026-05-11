// ============================================================================
// payment-channel.ts — derive payment channel from a payments_v2 row.
// SOT: payments_v2.meta.payment_method + meta.is_erip + card_last4 + provider.
// `transaction_type` НЕ используется как канал (это RU/EN тип операции).
//
// Discovery (2026-05-11):
//   distinct meta.payment_method: '', 'credit_card', 'erip'
//   distinct meta.is_erip: '', 'false', 'true'
//   provider: 'bepaid' | 'admin' | 'admin_test'
//   bePaid не размечает Apple Pay / Google Pay — они выглядят как card.
// ============================================================================

export type PaymentChannel =
  | 'card'
  | 'apple_pay'
  | 'google_pay'
  | 'erip'
  | 'bank_transfer'
  | 'other';

export interface PaymentRowLike {
  provider?: string | null;
  card_last4?: string | null;
  card_brand?: string | null;
  meta?: Record<string, any> | null;
}

export function derivePaymentChannel(row: PaymentRowLike | null | undefined): PaymentChannel | null {
  if (!row) return null;
  const meta = row.meta || {};
  const pm = (meta.payment_method ?? '').toString().toLowerCase();
  const isErip = meta.is_erip === true || meta.is_erip === 'true' || pm === 'erip';
  if (isErip) return 'erip';
  if (pm === 'apple_pay') return 'apple_pay';
  if (pm === 'google_pay') return 'google_pay';
  if (pm === 'bank_transfer') return 'bank_transfer';
  if (pm === 'credit_card' || pm === 'card') return 'card';
  if (row.card_last4 && row.card_last4.length > 0) return 'card';
  if (row.provider === 'admin' || row.provider === 'admin_test') return 'other';
  return 'other';
}

export const CHANNEL_LABELS_RU: Record<PaymentChannel, string> = {
  card: 'Карта',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  erip: 'ЕРИП',
  bank_transfer: 'Банковский перевод',
  other: 'Иное',
};
