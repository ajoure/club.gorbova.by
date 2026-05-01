/**
 * check-month-purchase.ts — shared helper для month-gate.
 *
 * Контракт:
 * - Решение по UUID (tariff_id) и каноническому ключу месяца YYYY-MM.
 * - SOT: orders_v2 (paid) c meta.deal_month = month, опционально совпадает tariff_id.
 * - Используется только когда rule.conditions.match_purchase_month === true.
 * - НИКОГДА не вызывается «эвристически» — gate активируется только явным флагом в правиле.
 *
 * Возвращает true, если у пользователя есть оплаченный заказ в указанный месяц
 * по указанному тарифу (если tariff_id передан) или по любому тарифу (если null).
 *
 * Использует RPC public.has_month_purchase(_user_id, _tariff_id, _month).
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface MonthPurchaseInput {
  user_id: string;
  /** Канонический ключ месяца в формате YYYY-MM (например, "2025-02"). */
  month: string;
  /** Если задан — проверка ограничивается конкретным тарифом. */
  tariff_id?: string | null;
}

export interface MonthPurchaseResult {
  passed: boolean;
  reason:
    | 'matched'
    | 'no_paid_order_in_month'
    | 'invalid_month_format'
    | 'rpc_error';
  rpc_error?: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(month: unknown): month is string {
  return typeof month === 'string' && MONTH_RE.test(month);
}

/**
 * Проверка наличия оплаченного заказа в указанный месяц.
 * Read-only. Никаких side-эффектов.
 */
export async function checkMonthPurchase(
  supabase: SupabaseClient,
  input: MonthPurchaseInput,
): Promise<MonthPurchaseResult> {
  if (!isValidMonthKey(input.month)) {
    return { passed: false, reason: 'invalid_month_format' };
  }

  const { data, error } = await supabase.rpc('has_month_purchase', {
    _user_id: input.user_id,
    _tariff_id: input.tariff_id ?? null,
    _month: input.month,
  });

  if (error) {
    console.error('[check-month-purchase] RPC error:', error.message);
    return { passed: false, reason: 'rpc_error', rpc_error: error.message };
  }

  return data === true
    ? { passed: true, reason: 'matched' }
    : { passed: false, reason: 'no_paid_order_in_month' };
}
