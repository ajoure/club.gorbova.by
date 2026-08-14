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

export interface AnyMonthPurchaseInput {
  user_id: string;
  months: string[];
  tariff_id?: string | null;
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

/**
 * OR-check for several purchase months. Exact-tariff rules use the existing
 * bulk RPC, so notification audience checks make one database round-trip per
 * rule/user rather than one per month. Product-only rules retain the generic
 * single-month RPC because the bulk contract requires an exact tariff UUID.
 */
export async function checkAnyMonthPurchase(
  supabase: SupabaseClient,
  input: AnyMonthPurchaseInput,
): Promise<MonthPurchaseResult> {
  const months = [...new Set(input.months.filter(isValidMonthKey))];
  if (months.length === 0) {
    return { passed: false, reason: 'invalid_month_format' };
  }

  if (input.tariff_id) {
    const items = months.map((month, index) => ({
      lesson_id: `live-access-month-${index}`,
      tariff_id: input.tariff_id,
      content_month: month,
    }));
    const { data, error } = await supabase.rpc('has_month_purchase_bulk', {
      _user_id: input.user_id,
      _items: items,
    });

    if (error) {
      console.error('[check-month-purchase] Bulk RPC error:', error.message);
      return { passed: false, reason: 'rpc_error', rpc_error: error.message };
    }

    const passed = Array.isArray(data) && data.some((row) => row?.has_purchase === true);
    return passed
      ? { passed: true, reason: 'matched' }
      : { passed: false, reason: 'no_paid_order_in_month' };
  }

  let sawRpcError: string | undefined;
  for (const month of months) {
    const result = await checkMonthPurchase(supabase, {
      user_id: input.user_id,
      tariff_id: null,
      month,
    });
    if (result.passed) return result;
    if (result.reason === 'rpc_error') sawRpcError = result.rpc_error;
  }

  return sawRpcError
    ? { passed: false, reason: 'rpc_error', rpc_error: sawRpcError }
    : { passed: false, reason: 'no_paid_order_in_month' };
}
