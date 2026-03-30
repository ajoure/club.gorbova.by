/**
 * Phase 1: Unified access window resolution.
 * 
 * Determines access_start and access_end for grant/extend operations.
 * Priority:
 *   1. Explicit window (from event/caller)
 *   2. Flow window (from product flow)
 *   3. Tariff duration (access_days)
 *   4. Config rule (products_v2.meta.access_window_rule = 'calendar_month')
 *   5. Extend existing (GREATEST mode)
 * 
 * All calendar-month logic previously hardcoded via CLUB_PRODUCT_ID is now
 * driven by products_v2.meta->>'access_window_rule'.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AccessWindowInput {
  /** Product ID to resolve window rule for */
  productId: string;
  /** Tariff access_days (from tariffs table) */
  tariffAccessDays?: number | null;
  /** Explicit custom access days override */
  customAccessDays?: number | null;
  /** Explicit access start override */
  customAccessStartAt?: string | null;
  /** Base start date (e.g. order.created_at) */
  baseStartDate?: Date;
  /** If true, try to extend from existing active subscription */
  extendFromCurrent?: boolean;
  /** User ID for existing subscription lookup */
  userId?: string;
  /** Supabase client for DB lookups */
  supabase?: SupabaseClient;
}

export interface AccessWindowResult {
  accessStart: Date;
  accessEnd: Date;
  windowDays: number | null;
  sourceWindowRule: 'explicit' | 'flow' | 'tariff_duration' | 'calendar_month' | 'default_30d';
  previousEnd: string | null;
  isCalendarMonth: boolean;
}

/**
 * Check if a product uses calendar_month access window rule.
 * Reads from products_v2.meta->>'access_window_rule'.
 */
export async function isCalendarMonthProduct(
  supabase: SupabaseClient,
  productId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('products_v2')
    .select('meta')
    .eq('id', productId)
    .maybeSingle();

  const meta = data?.meta as Record<string, unknown> | null;
  return meta?.access_window_rule === 'calendar_month';
}

/**
 * Calculate calendar month end date from a start date.
 * Handles edge cases like 31 Jan → 28/29 Feb.
 * 
 * @param start - Start date
 * @param normalizeHourUtc - UTC hour to normalize to (default 12 = noon UTC)
 */
export function calcCalendarMonthEnd(start: Date, normalizeHourUtc: number = 12): Date {
  const endDate = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    start.getUTCDate(),
    normalizeHourUtc, 0, 0
  ));

  // Edge case: 31 Jan → clamp to last day of Feb
  if (endDate.getUTCDate() !== start.getUTCDate()) {
    return new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + 2,
      0, // Last day of previous month
      normalizeHourUtc, 0, 0
    ));
  }

  return endDate;
}

/**
 * Resolve access window for a grant/extend operation.
 */
export async function resolveAccessWindow(
  input: AccessWindowInput
): Promise<AccessWindowResult> {
  const {
    productId,
    tariffAccessDays,
    customAccessDays,
    customAccessStartAt,
    baseStartDate,
    extendFromCurrent,
    userId,
    supabase,
  } = input;

  const now = new Date();
  let previousEnd: string | null = null;

  // 1. Determine start date
  let accessStart = baseStartDate || now;
  if (customAccessStartAt) {
    accessStart = new Date(customAccessStartAt);
  }

  // 2. Check extend from existing subscription
  if (extendFromCurrent && userId && supabase) {
    const { data: activeSub } = await supabase
      .from('subscriptions_v2')
      .select('id, access_end_at')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .eq('status', 'active')
      .order('access_end_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSub?.access_end_at && new Date(activeSub.access_end_at) > now) {
      previousEnd = activeSub.access_end_at;
      accessStart = new Date(activeSub.access_end_at);
    }
  }

  // 3. Priority 1: Explicit custom days
  if (customAccessDays) {
    const accessEnd = new Date(accessStart.getTime() + customAccessDays * 24 * 60 * 60 * 1000);
    return {
      accessStart,
      accessEnd,
      windowDays: customAccessDays,
      sourceWindowRule: 'explicit',
      previousEnd,
      isCalendarMonth: false,
    };
  }

  // 4. Priority 4: Config rule (calendar_month)
  let useCalendarMonth = false;
  if (supabase) {
    useCalendarMonth = await isCalendarMonthProduct(supabase, productId);
  }

  if (useCalendarMonth) {
    const accessEnd = calcCalendarMonthEnd(accessStart);
    return {
      accessStart,
      accessEnd,
      windowDays: null,
      sourceWindowRule: 'calendar_month',
      previousEnd,
      isCalendarMonth: true,
    };
  }

  // 5. Priority 3: Tariff duration
  const days = tariffAccessDays || 30;
  const accessEnd = new Date(accessStart.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    accessStart,
    accessEnd,
    windowDays: days,
    sourceWindowRule: tariffAccessDays ? 'tariff_duration' : 'default_30d',
    previousEnd,
    isCalendarMonth: false,
  };
}
