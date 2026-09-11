import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface PaymentLike { status?: string | null; paid_at?: string | null; created_at?: string | null; }
interface DealLike {
  deal_date?: string | null;
  created_at?: string | null;
  payments_v2?: PaymentLike[] | null;
  meta?: unknown;
  purchase_snapshot?: unknown;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const flag = (value: unknown) => value === true || value === "true";
export function isHistoricalOnlyDeal(deal: DealLike): boolean {
  return flag(record(deal.meta).history_only) || flag(record(deal.purchase_snapshot).history_only);
}
function validDate(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}
/** Canonical writer supplies deal_date. Later payments/rebills never move it.
 * created_at records import time for history-only facts, so cannot date their purchase.
 * Source dates are restored into deal_date by the reviewed source-backed repair.
 */
export function getEffectiveDealDate(deal: DealLike, _externalPayments?: PaymentLike[] | null): string | null {
  const canonical = validDate(deal.deal_date);
  if (canonical) return canonical;
  return isHistoricalOnlyDeal(deal) ? null : validDate(deal.created_at);
}
export function getEffectiveDealTimestamp(deal: DealLike): number {
  const date = getEffectiveDealDate(deal);
  return date ? Date.parse(date) : 0;
}
/** Same unknown-date wording in cards, detail headers, tables and exports. */
export function formatEffectiveDealDate(deal: DealLike, pattern: string): string {
  const date = getEffectiveDealDate(deal);
  if (!date) return isHistoricalOnlyDeal(deal) ? "Историческая покупка · дата неизвестна" : "Дата неизвестна";
  return format(new Date(date), pattern, { locale: ru });
}
