/**
 * getEffectiveDealDate — единый хелпер для канонической даты сделки.
 *
 * Правило приоритета:
 *   1. Если есть succeeded-платежи → MAX(paid_at) среди них, fallback MAX(created_at)
 *   2. Иначе → deal.deal_date || deal.created_at
 *
 * Используется во всех экранах: AdminDeals, ContactDetailSheet,
 * ContactDealsDialog, DealDetailSheet — чтобы дата была единой.
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
 * @param deal — объект сделки с вложенными payments_v2
 * @param externalPayments — внешний массив платежей (для случаев,
 *   когда payments загружаются отдельным запросом, как в ContactDealsDialog)
 */
export function getEffectiveDealDate(
  deal: DealLike,
  externalPayments?: PaymentLike[] | null,
): string {
  const payments = externalPayments ?? deal.payments_v2 ?? [];

  // Succeeded payments sorted by date descending
  const succeeded = payments
    .filter((p) => p.status === "succeeded")
    .map((p) => ({
      ts: new Date(p.paid_at || p.created_at || 0).getTime(),
      iso: p.paid_at || p.created_at || null,
    }))
    .filter((x) => x.ts > 0)
    .sort((a, b) => b.ts - a.ts);

  if (succeeded.length > 0 && succeeded[0].iso) {
    return succeeded[0].iso;
  }

  // Fallback: deal_date || created_at
  return deal.deal_date || deal.created_at || new Date().toISOString();
}
