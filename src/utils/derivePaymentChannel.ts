// ============================================================================
// derivePaymentChannel.ts (frontend)
// ----------------------------------------------------------------------------
// Frontend mirror of supabase/functions/_shared/document-resolver-v2/payment-channel.ts.
// Keep logic in sync. Do not diverge.
//
// SOT: payments_v2.meta.payment_method + meta.is_erip + card_last4 + provider.
// Известное ограничение bePaid: Apple Pay / Google Pay сейчас приходят как
// `card` (отдельные каналы провайдер не размечает).
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

export const PAYMENT_CHANNEL_OPTIONS: { value: PaymentChannel; label: string }[] = [
  { value: 'card', label: CHANNEL_LABELS_RU.card },
  { value: 'apple_pay', label: CHANNEL_LABELS_RU.apple_pay },
  { value: 'google_pay', label: CHANNEL_LABELS_RU.google_pay },
  { value: 'erip', label: CHANNEL_LABELS_RU.erip },
  { value: 'bank_transfer', label: CHANNEL_LABELS_RU.bank_transfer },
];
