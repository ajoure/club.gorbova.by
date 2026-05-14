/**
 * getEffectiveDealDate — единый хелпер для канонической даты сделки.
 *
 * SOT (PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05):
 *   1. order.deal_date  (источник истины — устанавливается canonical writer)
 *   2. order.created_at (fallback при отсутствии deal_date)
 *
 * Платежи (payments_v2.paid_at) НЕ участвуют в определении канонической
 * даты сделки. Сделка может содержать платёж более поздним числом
 * (rebill/доплата), но месяц/дата сделки от этого не меняются.
 *
 * Дефект Ларисы (12-13 мая 2026, REBILL-debug): заголовок мартовской сделки
 * показывал «13 мая» из-за MAX(payment.paid_at). Это исправлено: header
 * теперь берётся строго из deal_date.
 *
 * STOP-guard: deal_date в БД НЕ изменяется. Это чисто read-model/UI хелпер.
 */

interface PaymentLike {
  status?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
}

interface DealLike {
  deal_date?: string | null;
  created_at?: string | null;
  payments_v2?: PaymentLike[] | null;
}

/**
 * Возвращает ISO-строку канонической даты для отображения сделки.
 *
 * @param deal — объект сделки (требуется только deal_date / created_at)
 * @param _externalPayments — устарел; параметр сохранён для backward-compat
 *   с существующими callers (AdminDeals/ContactDealsDialog), но больше
 *   не влияет на результат.
 */
export function getEffectiveDealDate(
  deal: DealLike,
  _externalPayments?: PaymentLike[] | null,
): string {
  return deal.deal_date || deal.created_at || new Date().toISOString();
}
