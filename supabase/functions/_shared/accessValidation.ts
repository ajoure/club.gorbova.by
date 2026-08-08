/**
 * PATCH 3 + P0.9.5 + PATCH-STAT-1 + PATCH 4: Centralized Access Validation
 * 
 * ЕДИНСТВЕННАЯ реализация hasValidAccess() для всего проекта.
 * Все edge functions должны импортировать из этого файла.
 * 
 * PATCH-STAT-1: When clubId is provided, subscriptions and entitlements
 * are scoped via product_club_mappings to prevent cross-club access leak.
 * 
 * PATCH 4: Grace 72h for subscriptions + billing-day protection for provider_managed SBS.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { toTzDateKey, dayWindowUtc, APP_TZ } from './timezone.ts';

/** Grace period: 72 hours after access_end_at, subscription still counts as valid */
const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

export interface AccessCheckResult {
  valid: boolean;
  source?: 'subscription' | 'entitlement' | 'manual_access' | 'paid_order_rule' | 'telegram_access' | 'telegram_grant';
  endAt?: string | null;
  subscriptionId?: string;
  entitlementId?: string;
  manualAccessId?: string;
  telegramAccessId?: string;
  telegramGrantId?: string;
  orderId?: string;
  accessRuleId?: string;
}

/**
 * SPLIT-HELPER (additive, 2026-05-22):
 * — `hasCommercialAccess` — деньги/право доступа. Источники: subscriptions_v2, entitlements,
 *   telegram_manual_access, billing-day protection. Должна использоваться revoke/kick/grace.
 * — `hasTelegramProjection` — физическое присутствие в Telegram. Источники: telegram_access,
 *   telegram_access_grants. Должна использоваться UI-индикаторами «в чате/канале» и Telegram-sync.
 * — `hasValidAccess` (legacy) — объединение обоих. Сохранён для обратной совместимости.
 *   Колл-сайты revoke/kick/grace мигрируются отдельным патчем ПОСЛЕ dry-run rowcount.
 */
export type CommercialSource = 'subscription' | 'entitlement' | 'manual_access' | 'paid_order_rule';
export type ProjectionSource = 'telegram_access' | 'telegram_grant';

/**
 * Keep the commercial source that grants the widest access window.
 * NULL endAt is canonical unlimited access and therefore always wins.
 * Equal windows keep the existing source so the source priority remains stable.
 */
export function selectWiderCommercialAccess(
  current: AccessCheckResult | undefined,
  candidate: AccessCheckResult,
): AccessCheckResult {
  if (!candidate.valid) return current ?? candidate;
  if (!current?.valid) return candidate;

  if (current.endAt === null) return current;
  if (candidate.endAt === null) return candidate;

  const currentMs = current.endAt ? new Date(current.endAt).getTime() : Number.NEGATIVE_INFINITY;
  const candidateMs = candidate.endAt ? new Date(candidate.endAt).getTime() : Number.NEGATIVE_INFINITY;

  if (!Number.isFinite(candidateMs)) return current;
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) return candidate;
  return current;
}

export interface ClubAccessRuleScope {
  id: string;
  productId: string;
  tariffId: string | null;
  durationDays: number | null;
  conditions: Record<string, unknown> | null;
}

function parsePositiveDurationDays(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A finite club bonus is anchored to the confirmed payment, not to the
 * primary product subscription end and not to the moment a repair runs.
 */
export function calculateRuleBoundClubEndAt(
  paidAt: string,
  durationDays: number,
): string | null {
  const paidAtMs = new Date(paidAt).getTime();
  if (!Number.isFinite(paidAtMs) || !Number.isInteger(durationDays) || durationDays <= 0) {
    return null;
  }
  return new Date(paidAtMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

function ruleMatchesSource(
  rule: ClubAccessRuleScope,
  productId: string | null,
  tariffId: string | null,
): boolean {
  if (!productId || rule.productId !== productId) return false;
  return rule.tariffId === null || rule.tariffId === tariffId;
}

function conditionMetForUser(
  rule: ClubAccessRuleScope,
  userId: string,
  paidOrders: Array<{ user_id: string; product_id: string | null; tariff_id: string | null }>,
): boolean {
  const conditionType = rule.conditions?.condition_type;
  if (!conditionType) return true;
  if (conditionType !== 'prior_purchase') return false;

  const requiredProductId = typeof rule.conditions?.required_product_id === 'string'
    ? rule.conditions.required_product_id
    : null;
  const requiredTariffId = typeof rule.conditions?.required_tariff_id === 'string'
    ? rule.conditions.required_tariff_id
    : null;
  if (!requiredProductId) return false;

  return paidOrders.some(order =>
    order.user_id === userId &&
    order.product_id === requiredProductId &&
    (!requiredTariffId || order.tariff_id === requiredTariffId)
  );
}

async function getClubRuleScope(
  supabase: SupabaseClient,
  clubId?: string,
): Promise<ClubAccessRuleScope[] | null> {
  if (!clubId) return null;

  const { data, error } = await supabase
    .from('access_rules')
    .select('id, product_id, tariff_id, duration_days, conditions')
    .eq('target_ref', clubId)
    .eq('grant_target_type', 'club')
    .eq('is_active', true);

  if (error) throw new Error(`club_access_rules_failed: ${error.message}`);

  const rawRules = data || [];
  const unresolvedTariffIds = [...new Set(
    rawRules
      .filter((rule: any) => !rule.product_id && rule.tariff_id)
      .map((rule: any) => rule.tariff_id),
  )];
  const tariffProductIds = new Map<string, string>();

  if (unresolvedTariffIds.length > 0) {
    const { data: tariffs, error: tariffError } = await supabase
      .from('tariffs')
      .select('id, product_id')
      .in('id', unresolvedTariffIds);
    if (tariffError) throw new Error(`club_access_rule_tariffs_failed: ${tariffError.message}`);
    for (const tariff of tariffs || []) {
      if (tariff.id && tariff.product_id) tariffProductIds.set(tariff.id, tariff.product_id);
    }
  }

  const normalized: ClubAccessRuleScope[] = [];
  for (const rule of rawRules as any[]) {
    const productId = rule.product_id || (rule.tariff_id ? tariffProductIds.get(rule.tariff_id) : null);
    // An unresolved rule must never broaden access.
    if (!productId) continue;
    const durationDays = parsePositiveDurationDays(rule.duration_days);
    // Invalid finite configuration must fail closed; only an actual NULL means
    // an open-ended/direct mapping.
    if (rule.duration_days !== null && rule.duration_days !== undefined && durationDays === null) {
      continue;
    }
    normalized.push({
      id: rule.id,
      productId,
      tariffId: rule.tariff_id || null,
      durationDays,
      conditions: rule.conditions && typeof rule.conditions === 'object' ? rule.conditions : null,
    });
  }
  return normalized;
}

/**
 * Fetch product IDs mapped to a specific club.
 * Returns null if no clubId provided (global/unscoped check).
 */
async function getClubProductIds(
  supabase: SupabaseClient,
  clubId?: string
): Promise<string[] | null> {
  const rules = await getClubRuleScope(supabase, clubId);
  if (rules === null) return null;

  // Only open-ended rules align the club with the source product window.
  // Finite bonus rules are resolved from paid_at + duration_days below; adding
  // their product IDs here would silently turn 30 days into 6/8/10 months.
  return [...new Set(
    rules.filter(rule => rule.durationDays === null).map(rule => rule.productId),
  )];
}

/**
 * PATCH 4: Billing-day protection secondary check.
 * Returns valid if user has a provider_managed subscription with next_charge_at = today (APP_TZ = Europe/Minsk)
 * and now < next_charge_at + BILLING_DAY_PROTECTION_HOURS.
 * 
 * Writes audit_log when protection fires.
 */
async function checkBillingDayProtection(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  clubProductIds: string[] | null
): Promise<AccessCheckResult> {
  const nowStr = now.toISOString();
  const todayKey = toTzDateKey(nowStr, APP_TZ);
  const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);

  const q = supabase
    .from('subscriptions_v2')
    .select('id, next_charge_at, access_end_at')
    .eq('user_id', userId)
    .eq('billing_type', 'provider_managed')
    .neq('status', 'canceled')
    .gte('next_charge_at', todayStart)
    .lt('next_charge_at', todayEnd)
    .limit(1);

  if (clubProductIds !== null && clubProductIds.length > 0) {
    q.in('product_id', clubProductIds);
  } else if (clubProductIds !== null && clubProductIds.length === 0) {
    return { valid: false };
  }

  const { data: billingDaySub } = await q.maybeSingle();

  if (billingDaySub?.next_charge_at) {
    // End-of-day protection: valid until 23:59:59 APP_TZ (todayEnd - 1s)
    const endOfDayUtcMs = new Date(todayEnd).getTime() - 1000;
    if (now.getTime() <= endOfDayUtcMs) {
      // Audit log — fire-and-forget
      supabase.from('audit_logs').insert({
        action: 'access.validation.billing_day_protected',
        actor_type: 'system',
        actor_label: 'accessValidation',
        target_user_id: userId,
        meta: {
          subscription_id: billingDaySub.id,
          next_charge_at: billingDaySub.next_charge_at,
          now: nowStr,
          protection_until: new Date(endOfDayUtcMs).toISOString(),
        },
      }).then(() => {});

      return {
        valid: true,
        source: 'subscription',
        endAt: billingDaySub.access_end_at,
        subscriptionId: billingDaySub.id,
      };
    }
  }

  return { valid: false };
}

/**
 * ЕДИНСТВЕННАЯ реализация проверки доступа.
 * 
 * Проверяет 5 источников в порядке приоритета:
 * 1. subscriptions_v2 (status IN ['active', 'trial', 'past_due'] AND access_end_at > now - 72h grace)
 *    — when clubId provided: scoped via product_club_mappings
 * 2. entitlements (status = 'active' AND (expires_at IS NULL OR expires_at > now))
 *    — when clubId provided: scoped via product_club_mappings (product_id IS NULL = no access)
 * 3. telegram_manual_access (is_active = true AND (valid_until IS NULL OR valid_until > now))
 * 4. telegram_access (active_until IS NULL OR active_until > now)
 * 5. telegram_access_grants (status = 'active' AND (end_at IS NULL OR end_at > now))
 * 6. PATCH 4: Billing-day protection for provider_managed SBS (secondary check)
 */
export async function hasValidAccess(
  supabase: SupabaseClient,
  userId: string,
  clubId?: string,
  now?: Date
): Promise<AccessCheckResult> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  // PATCH 4: Grace period — subscription access_end_at is checked against now - 72h
  const subGraceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();

  // PATCH-STAT-1: Get club-scoped product IDs when clubId is provided
  const clubProductIds = await getClubProductIds(supabase, clubId);

  // 1. Check active subscription (with 72h grace on access_end_at)
  const subQuery = supabase
    .from('subscriptions_v2')
    .select('id, access_end_at')
    .eq('user_id', userId)
    .in('status', ['active', 'trial', 'past_due'])
    .or(`access_end_at.is.null,access_end_at.gt.${subGraceNowStr}`)
    .limit(1);

  // PATCH-STAT-1: scope by club products when clubId provided
  if (clubProductIds !== null) {
    if (clubProductIds.length === 0) {
      // No products mapped to this club — skip subscription check
    } else {
      subQuery.in('product_id', clubProductIds);
    }
  }

  const { data: activeSub } = clubProductIds !== null && clubProductIds.length === 0
    ? { data: null }
    : await subQuery.maybeSingle();

  if (activeSub) {
    return {
      valid: true,
      source: 'subscription',
      endAt: activeSub.access_end_at,
      subscriptionId: activeSub.id,
    };
  }

  // 2. Check active entitlement (NO grace — entitlements use strict dates)
  if (clubProductIds !== null && clubProductIds.length === 0) {
    // No products mapped — skip entitlement check
  } else {
    const entQuery = supabase
      .from('entitlements')
      .select('id, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`)
      .limit(1);

    if (clubProductIds !== null) {
      entQuery.in('product_id', clubProductIds);
    }

    const { data: activeEntitlement } = await entQuery.maybeSingle();

    if (activeEntitlement) {
      return {
        valid: true,
        source: 'entitlement',
        endAt: activeEntitlement.expires_at,
        entitlementId: activeEntitlement.id,
      };
    }
  }

  // 3. Check manual access
  const manualAccessQuery = supabase
    .from('telegram_manual_access')
    .select('id, valid_until')
    .eq('user_id', userId)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gt.${nowStr}`)
    .limit(1);
  
  if (clubId) {
    manualAccessQuery.eq('club_id', clubId);
  }

  const { data: manualAccess } = await manualAccessQuery.maybeSingle();

  if (manualAccess) {
    return {
      valid: true,
      source: 'manual_access',
      endAt: manualAccess.valid_until,
      manualAccessId: manualAccess.id,
    };
  }

  // 4. Check telegram_access
  const telegramAccessQuery = supabase
    .from('telegram_access')
    .select('id, active_until, state_chat, state_channel')
    .eq('user_id', userId)
    .or(`active_until.is.null,active_until.gt.${nowStr}`)
    .neq('state_chat', 'revoked')
    .neq('state_channel', 'revoked')
    .limit(1);
  
  if (clubId) {
    telegramAccessQuery.eq('club_id', clubId);
  }

  const { data: telegramAccess } = await telegramAccessQuery.maybeSingle();

  if (telegramAccess) {
    return {
      valid: true,
      source: 'telegram_access',
      endAt: telegramAccess.active_until,
      telegramAccessId: telegramAccess.id,
    };
  }

  // 5. Check telegram_access_grants
  const grantsQuery = supabase
    .from('telegram_access_grants')
    .select('id, end_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`end_at.is.null,end_at.gt.${nowStr}`)
    .limit(1);
  
  if (clubId) {
    grantsQuery.eq('club_id', clubId);
  }

  const { data: telegramGrant } = await grantsQuery.maybeSingle();

  if (telegramGrant) {
    return {
      valid: true,
      source: 'telegram_grant',
      endAt: telegramGrant.end_at,
      telegramGrantId: telegramGrant.id,
    };
  }

  // 6. PATCH 4: Billing-day protection for provider_managed SBS
  const billingDayResult = await checkBillingDayProtection(supabase, userId, effectiveNow, clubProductIds);
  if (billingDayResult.valid) {
    return billingDayResult;
  }

  return { valid: false };
}

/**
 * Batch check access for multiple users (set-based, no N+1)
 * Returns a Map of userId -> AccessCheckResult
 * 
 * PATCH-STAT-1: When clubId is provided, subscriptions and entitlements
 * are scoped via product_club_mappings.
 * PATCH 4: Grace 72h for subscriptions + billing-day protection for provider_managed.
 */
export async function hasValidAccessBatch(
  supabase: SupabaseClient,
  userIds: string[],
  clubId?: string,
  now?: Date
): Promise<Map<string, AccessCheckResult>> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  // PATCH 4: Grace period for subscriptions
  const subGraceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();
  const results = new Map<string, AccessCheckResult>();

  // Initialize all as invalid
  for (const userId of userIds) {
    results.set(userId, { valid: false });
  }

  if (userIds.length === 0) return results;

  // PATCH-STAT-1: Get club-scoped product IDs when clubId is provided
  const clubProductIds = await getClubProductIds(supabase, clubId);

  // 1. Batch check subscriptions (with 72h grace)
  if (clubProductIds === null || clubProductIds.length > 0) {
    const subQuery = supabase
      .from('subscriptions_v2')
      .select('id, user_id, access_end_at')
      .in('user_id', userIds)
      .in('status', ['active', 'trial', 'past_due'])
      .or(`access_end_at.is.null,access_end_at.gt.${subGraceNowStr}`);

    if (clubProductIds !== null) {
      subQuery.in('product_id', clubProductIds);
    }

    const { data: activeSubs } = await subQuery;

    for (const sub of activeSubs || []) {
      if (!results.get(sub.user_id)?.valid) {
        results.set(sub.user_id, {
          valid: true,
          source: 'subscription',
          endAt: sub.access_end_at,
          subscriptionId: sub.id,
        });
      }
    }
  }

  // 2. Batch check entitlements (only for users without subscription, NO grace)
  const usersWithoutAccess = userIds.filter((uid) => !results.get(uid)?.valid);
  if (usersWithoutAccess.length > 0 && (clubProductIds === null || clubProductIds.length > 0)) {
    const entQuery = supabase
      .from('entitlements')
      .select('id, user_id, expires_at')
      .in('user_id', usersWithoutAccess)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`);

    // PATCH-STAT-1: scope by club products
    if (clubProductIds !== null) {
      entQuery.in('product_id', clubProductIds);
    }

    const { data: activeEntitlements } = await entQuery;

    for (const ent of activeEntitlements || []) {
      if (!results.get(ent.user_id)?.valid) {
        results.set(ent.user_id, {
          valid: true,
          source: 'entitlement',
          endAt: ent.expires_at,
          entitlementId: ent.id,
        });
      }
    }
  }

  // 3. Batch check manual access (only for remaining users)
  const stillWithoutAccess = userIds.filter((uid) => !results.get(uid)?.valid);
  if (stillWithoutAccess.length > 0) {
    const manualQuery = supabase
      .from('telegram_manual_access')
      .select('id, user_id, valid_until')
      .in('user_id', stillWithoutAccess)
      .eq('is_active', true)
      .or(`valid_until.is.null,valid_until.gt.${nowStr}`);
    
    if (clubId) {
      manualQuery.eq('club_id', clubId);
    }

    const { data: manualAccessList } = await manualQuery;

    for (const ma of manualAccessList || []) {
      if (!results.get(ma.user_id)?.valid) {
        results.set(ma.user_id, {
          valid: true,
          source: 'manual_access',
          endAt: ma.valid_until,
          manualAccessId: ma.id,
        });
      }
    }
  }

  // 4. Batch check telegram_access
  const stillWithoutAccess2 = userIds.filter((uid) => !results.get(uid)?.valid);
  if (stillWithoutAccess2.length > 0) {
    const telegramQuery = supabase
      .from('telegram_access')
      .select('id, user_id, active_until, state_chat, state_channel')
      .in('user_id', stillWithoutAccess2)
      .or(`active_until.is.null,active_until.gt.${nowStr}`)
      .neq('state_chat', 'revoked')
      .neq('state_channel', 'revoked');
    
    if (clubId) {
      telegramQuery.eq('club_id', clubId);
    }

    const { data: telegramAccessList } = await telegramQuery;

    for (const ta of telegramAccessList || []) {
      if (!results.get(ta.user_id)?.valid) {
        results.set(ta.user_id, {
          valid: true,
          source: 'telegram_access',
          endAt: ta.active_until,
          telegramAccessId: ta.id,
        });
      }
    }
  }

  // 5. Batch check telegram_access_grants
  const stillWithoutAccess3 = userIds.filter((uid) => !results.get(uid)?.valid);
  if (stillWithoutAccess3.length > 0) {
    const grantsQuery = supabase
      .from('telegram_access_grants')
      .select('id, user_id, end_at')
      .in('user_id', stillWithoutAccess3)
      .eq('status', 'active')
      .or(`end_at.is.null,end_at.gt.${nowStr}`);
    
    if (clubId) {
      grantsQuery.eq('club_id', clubId);
    }

    const { data: grantsList } = await grantsQuery;

    for (const g of grantsList || []) {
      if (!results.get(g.user_id)?.valid) {
        results.set(g.user_id, {
          valid: true,
          source: 'telegram_grant',
          endAt: g.end_at,
          telegramGrantId: g.id,
        });
      }
    }
  }

  // 6. PATCH 4: Batch billing-day protection for remaining users
  const stillWithoutAccess4 = userIds.filter((uid) => !results.get(uid)?.valid);
  if (stillWithoutAccess4.length > 0) {
    const todayKey = toTzDateKey(nowStr, APP_TZ);
    const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);

    const bdQuery = supabase
      .from('subscriptions_v2')
      .select('id, user_id, next_charge_at, access_end_at')
      .in('user_id', stillWithoutAccess4)
      .eq('billing_type', 'provider_managed')
      .neq('status', 'canceled')
      .gte('next_charge_at', todayStart)
      .lt('next_charge_at', todayEnd);

    if (clubProductIds !== null && clubProductIds.length > 0) {
      bdQuery.in('product_id', clubProductIds);
    }

    const { data: billingDaySubs } = await bdQuery;

    for (const sub of billingDaySubs || []) {
      if (!results.get(sub.user_id)?.valid && sub.next_charge_at) {
        // End-of-day protection: valid until 23:59:59 APP_TZ
        const endOfDayUtcMs = new Date(todayEnd).getTime() - 1000;
        if (effectiveNow.getTime() <= endOfDayUtcMs) {
          results.set(sub.user_id, {
            valid: true,
            source: 'subscription',
            endAt: sub.access_end_at,
            subscriptionId: sub.id,
          });
          // Fire-and-forget audit
          supabase.from('audit_logs').insert({
            action: 'access.validation.billing_day_protected',
            actor_type: 'system',
            actor_label: 'accessValidation.batch',
            target_user_id: sub.user_id,
            meta: {
              subscription_id: sub.id,
              next_charge_at: sub.next_charge_at,
              now: nowStr,
              protection_until: new Date(endOfDayUtcMs).toISOString(),
            },
          }).then(() => {});
        }
      }
    }
  }

  return results;
}

// ============================================================================
// SPLIT HELPERS (additive, 2026-05-22) — НЕ менять поведение существующих
// колл-сайтов в этом же патче. Только новые функции, готовые к миграции.
// ============================================================================

function selectApplicableRules(
  rules: ClubAccessRuleScope[],
  productId: string | null,
  tariffId: string | null,
): ClubAccessRuleScope[] {
  const matching = rules.filter(rule => ruleMatchesSource(rule, productId, tariffId));
  const tariffSpecific = matching.filter(rule => rule.tariffId !== null);
  return tariffSpecific.length > 0
    ? tariffSpecific
    : matching.filter(rule => rule.tariffId === null);
}

async function resolveClubScopedCommercialAccessBatch(
  supabase: SupabaseClient,
  userIds: string[],
  clubId: string,
  effectiveNow: Date,
): Promise<Map<string, AccessCheckResult>> {
  const nowStr = effectiveNow.toISOString();
  const subGraceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();
  const results = new Map<string, AccessCheckResult>();
  for (const uid of userIds) results.set(uid, { valid: false });
  if (userIds.length === 0) return results;

  const clubRules = await getClubRuleScope(supabase, clubId) || [];
  const directRules = clubRules.filter(rule => rule.durationDays === null);
  const bonusRules = clubRules.filter(rule => rule.durationDays !== null);
  const directProductIds = [...new Set(directRules.map(rule => rule.productId))];

  const conditionProductIds = clubRules.flatMap(rule => {
    const required = rule.conditions?.required_product_id;
    return typeof required === 'string' ? [required] : [];
  });
  const paidOrderProductIds = [...new Set([
    ...bonusRules.map(rule => rule.productId),
    ...conditionProductIds,
  ])];
  let paidOrders: Array<{
    id: string;
    user_id: string;
    product_id: string | null;
    tariff_id: string | null;
  }> = [];

  if (paidOrderProductIds.length > 0) {
    const { data, error } = await supabase
      .from('orders_v2')
      .select('id, user_id, product_id, tariff_id')
      .in('user_id', userIds)
      .in('product_id', paidOrderProductIds)
      .eq('status', 'paid');
    if (error) throw new Error(`commercial_access_rule_orders_failed: ${error.message}`);
    paidOrders = (data || []) as typeof paidOrders;
  }

  // 1. Direct club products: their own paid subscription window remains SoT.
  if (directProductIds.length > 0) {
    const { data, error } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, tariff_id, access_end_at')
      .in('user_id', userIds)
      .in('product_id', directProductIds)
      .in('status', ['active', 'trial', 'past_due'])
      .or(`access_end_at.is.null,access_end_at.gt.${subGraceNowStr}`);
    if (error) throw new Error(`commercial_access_subscriptions_failed: ${error.message}`);

    for (const sub of data || []) {
      const applicable = selectApplicableRules(directRules, sub.product_id, sub.tariff_id)
        .filter(rule => conditionMetForUser(rule, sub.user_id, paidOrders));
      if (applicable.length === 0) continue;
      results.set(sub.user_id, selectWiderCommercialAccess(results.get(sub.user_id), {
        valid: true,
        source: 'subscription',
        endAt: sub.access_end_at,
        subscriptionId: sub.id,
        accessRuleId: applicable[0].id,
      }));
    }

    const { data: entitlements, error: entitlementError } = await supabase
      .from('entitlements')
      .select('id, user_id, product_id, expires_at, meta')
      .in('user_id', userIds)
      .in('product_id', directProductIds)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`);
    if (entitlementError) throw new Error(`commercial_access_entitlements_failed: ${entitlementError.message}`);

    for (const entitlement of entitlements || []) {
      const tariffId = typeof entitlement.meta?.tariff_id === 'string'
        ? entitlement.meta.tariff_id
        : null;
      const applicable = selectApplicableRules(directRules, entitlement.product_id, tariffId)
        .filter(rule => conditionMetForUser(rule, entitlement.user_id, paidOrders));
      if (applicable.length === 0) continue;
      results.set(entitlement.user_id, selectWiderCommercialAccess(results.get(entitlement.user_id), {
        valid: true,
        source: 'entitlement',
        endAt: entitlement.expires_at,
        entitlementId: entitlement.id,
        accessRuleId: applicable[0].id,
      }));
    }
  }

  // 2. Finite bonus rules: confirmed paid_at + rule.duration_days. The primary
  // product's subscription end is deliberately never used here.
  const bonusSourceOrders = paidOrders.filter(order =>
    selectApplicableRules(bonusRules, order.product_id, order.tariff_id)
      .some(rule => conditionMetForUser(rule, order.user_id, paidOrders))
  );
  if (bonusSourceOrders.length > 0) {
    const orderIds = bonusSourceOrders.map(order => order.id);
    const { data: payments, error: paymentError } = await supabase
      .from('payments_v2')
      .select('id, order_id, paid_at')
      .in('order_id', orderIds)
      .eq('status', 'succeeded')
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: true });
    if (paymentError) throw new Error(`commercial_access_rule_payments_failed: ${paymentError.message}`);

    const firstPaidAtByOrder = new Map<string, string>();
    for (const payment of payments || []) {
      if (payment.order_id && payment.paid_at && !firstPaidAtByOrder.has(payment.order_id)) {
        firstPaidAtByOrder.set(payment.order_id, payment.paid_at);
      }
    }

    for (const order of bonusSourceOrders) {
      const paidAt = firstPaidAtByOrder.get(order.id);
      if (!paidAt) continue; // fail closed: no confirmed payment anchor
      const applicable = selectApplicableRules(bonusRules, order.product_id, order.tariff_id)
        .filter(rule => conditionMetForUser(rule, order.user_id, paidOrders));
      for (const rule of applicable) {
        const endAt = calculateRuleBoundClubEndAt(paidAt, rule.durationDays!);
        if (!endAt || new Date(endAt).getTime() <= effectiveNow.getTime()) continue;
        results.set(order.user_id, selectWiderCommercialAccess(results.get(order.user_id), {
          valid: true,
          source: 'paid_order_rule',
          endAt,
          orderId: order.id,
          accessRuleId: rule.id,
        }));
      }
    }
  }

  // 3. Manual club access is independent and may deliberately override rules.
  const manualQuery = supabase
    .from('telegram_manual_access')
    .select('id, user_id, valid_until')
    .in('user_id', userIds)
    .eq('club_id', clubId)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gt.${nowStr}`);
  const { data: manualRows, error: manualError } = await manualQuery;
  if (manualError) throw new Error(`commercial_access_manual_failed: ${manualError.message}`);
  for (const manual of manualRows || []) {
    results.set(manual.user_id, selectWiderCommercialAccess(results.get(manual.user_id), {
      valid: true,
      source: 'manual_access',
      endAt: manual.valid_until,
      manualAccessId: manual.id,
    }));
  }

  // 4. Billing-day protection applies only to direct club subscriptions.
  if (directProductIds.length > 0) {
    const todayKey = toTzDateKey(nowStr, APP_TZ);
    const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);
    const { data, error } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, tariff_id, next_charge_at, access_end_at')
      .in('user_id', userIds)
      .in('product_id', directProductIds)
      .eq('billing_type', 'provider_managed')
      .neq('status', 'canceled')
      .gte('next_charge_at', todayStart)
      .lt('next_charge_at', todayEnd);
    if (error) throw new Error(`commercial_access_billing_day_failed: ${error.message}`);

    const endOfDayUtcMs = new Date(todayEnd).getTime() - 1000;
    for (const sub of data || []) {
      const applicable = selectApplicableRules(directRules, sub.product_id, sub.tariff_id)
        .filter(rule => conditionMetForUser(rule, sub.user_id, paidOrders));
      if (applicable.length === 0 || effectiveNow.getTime() > endOfDayUtcMs) continue;
      const protectedUntil = sub.access_end_at
        ? new Date(Math.max(new Date(sub.access_end_at).getTime(), endOfDayUtcMs)).toISOString()
        : null;
      results.set(sub.user_id, selectWiderCommercialAccess(results.get(sub.user_id), {
        valid: true,
        source: 'subscription',
        endAt: protectedUntil,
        subscriptionId: sub.id,
        accessRuleId: applicable[0].id,
      }));
    }
  }

  return results;
}

/**
 * COMMERCIAL access only: subscriptions_v2 → entitlements → telegram_manual_access →
 * billing-day protection. Полностью игнорирует telegram_access / telegram_access_grants
 * (это технические проекции, а не право доступа).
 *
 * Назначение: revoke / kick / grace expiration — все решения, влияющие на жизненный
 * цикл коммерческого доступа. Stale telegram_access projection не должна больше
 * блокировать эти решения.
 */
export async function hasCommercialAccess(
  supabase: SupabaseClient,
  userId: string,
  clubId?: string,
  now?: Date,
): Promise<AccessCheckResult> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  const subGraceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();

  if (clubId) {
    const scoped = await resolveClubScopedCommercialAccessBatch(
      supabase,
      [userId],
      clubId,
      effectiveNow,
    );
    return scoped.get(userId) || { valid: false };
  }

  const clubProductIds = await getClubProductIds(supabase, clubId);

  // 1. subscriptions_v2 (с 72h grace)
  if (!(clubProductIds !== null && clubProductIds.length === 0)) {
    const subQuery = supabase
      .from('subscriptions_v2')
      .select('id, access_end_at')
      .eq('user_id', userId)
      .in('status', ['active', 'trial', 'past_due'])
      .or(`access_end_at.is.null,access_end_at.gt.${subGraceNowStr}`)
      .limit(1);

    if (clubProductIds !== null) subQuery.in('product_id', clubProductIds);

    const { data: activeSub } = await subQuery.maybeSingle();
    if (activeSub) {
      return {
        valid: true,
        source: 'subscription',
        endAt: activeSub.access_end_at,
        subscriptionId: activeSub.id,
      };
    }
  }

  // 2. entitlements (без grace)
  if (!(clubProductIds !== null && clubProductIds.length === 0)) {
    const entQuery = supabase
      .from('entitlements')
      .select('id, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`)
      .limit(1);

    if (clubProductIds !== null) entQuery.in('product_id', clubProductIds);

    const { data: activeEnt } = await entQuery.maybeSingle();
    if (activeEnt) {
      return {
        valid: true,
        source: 'entitlement',
        endAt: activeEnt.expires_at,
        entitlementId: activeEnt.id,
      };
    }
  }

  // 3. telegram_manual_access — ручной коммерческий грант от админа.
  // Не путать с telegram_access (технической проекцией).
  const manualQuery = supabase
    .from('telegram_manual_access')
    .select('id, valid_until')
    .eq('user_id', userId)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gt.${nowStr}`)
    .limit(1);

  if (clubId) manualQuery.eq('club_id', clubId);

  const { data: manualAccess } = await manualQuery.maybeSingle();
  if (manualAccess) {
    return {
      valid: true,
      source: 'manual_access',
      endAt: manualAccess.valid_until,
      manualAccessId: manualAccess.id,
    };
  }

  // 4. Billing-day protection — провайдер списывает сегодня, доступ держим до конца дня.
  const billingDayResult = await checkBillingDayProtection(supabase, userId, effectiveNow, clubProductIds);
  if (billingDayResult.valid) return billingDayResult;

  return { valid: false };
}

/**
 * TELEGRAM PROJECTION only: telegram_access → telegram_access_grants.
 * Отвечает на вопрос «есть ли у пользователя техническая запись о присутствии
 * в чате/канале», а НЕ «имеет ли он коммерческое право там быть».
 *
 * Назначение: UI-индикаторы «в чате/канале», Telegram-sync, диагностика
 * расхождений (commercial vs projection).
 */
export async function hasTelegramProjection(
  supabase: SupabaseClient,
  userId: string,
  clubId?: string,
  now?: Date,
): Promise<AccessCheckResult> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();

  // 1. telegram_access (не revoked)
  const taQuery = supabase
    .from('telegram_access')
    .select('id, active_until, state_chat, state_channel')
    .eq('user_id', userId)
    .or(`active_until.is.null,active_until.gt.${nowStr}`)
    .neq('state_chat', 'revoked')
    .neq('state_channel', 'revoked')
    .limit(1);

  if (clubId) taQuery.eq('club_id', clubId);

  const { data: ta } = await taQuery.maybeSingle();
  if (ta) {
    return {
      valid: true,
      source: 'telegram_access',
      endAt: ta.active_until,
      telegramAccessId: ta.id,
    };
  }

  // 2. telegram_access_grants
  const grantsQuery = supabase
    .from('telegram_access_grants')
    .select('id, end_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`end_at.is.null,end_at.gt.${nowStr}`)
    .limit(1);

  if (clubId) grantsQuery.eq('club_id', clubId);

  const { data: grant } = await grantsQuery.maybeSingle();
  if (grant) {
    return {
      valid: true,
      source: 'telegram_grant',
      endAt: grant.end_at,
      telegramGrantId: grant.id,
    };
  }

  return { valid: false };
}

/**
 * Batch-вариант hasCommercialAccess. Аналогичная логика, без telegram_access*.
 */
export async function hasCommercialAccessBatch(
  supabase: SupabaseClient,
  userIds: string[],
  clubId?: string,
  now?: Date,
): Promise<Map<string, AccessCheckResult>> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  const subGraceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();
  const results = new Map<string, AccessCheckResult>();
  for (const uid of userIds) results.set(uid, { valid: false });
  if (userIds.length === 0) return results;

  if (clubId) {
    return resolveClubScopedCommercialAccessBatch(supabase, userIds, clubId, effectiveNow);
  }

  const clubProductIds = await getClubProductIds(supabase, clubId);

  // 1. subscriptions
  if (clubProductIds === null || clubProductIds.length > 0) {
    const q = supabase
      .from('subscriptions_v2')
      .select('id, user_id, access_end_at')
      .in('user_id', userIds)
      .in('status', ['active', 'trial', 'past_due'])
      .or(`access_end_at.is.null,access_end_at.gt.${subGraceNowStr}`);
    if (clubProductIds !== null) q.in('product_id', clubProductIds);
    const { data, error } = await q;
    if (error) throw new Error(`commercial_access_subscriptions_failed: ${error.message}`);
    for (const s of data || []) {
      results.set(s.user_id, selectWiderCommercialAccess(results.get(s.user_id), {
        valid: true, source: 'subscription', endAt: s.access_end_at, subscriptionId: s.id,
      }));
    }
  }

  // 2. entitlements
  if (clubProductIds === null || clubProductIds.length > 0) {
    const q = supabase
      .from('entitlements')
      .select('id, user_id, expires_at')
      .in('user_id', userIds)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`);
    if (clubProductIds !== null) q.in('product_id', clubProductIds);
    const { data, error } = await q;
    if (error) throw new Error(`commercial_access_entitlements_failed: ${error.message}`);
    for (const e of data || []) {
      results.set(e.user_id, selectWiderCommercialAccess(results.get(e.user_id), {
        valid: true, source: 'entitlement', endAt: e.expires_at, entitlementId: e.id,
      }));
    }
  }

  // 3. telegram_manual_access
  if (userIds.length > 0) {
    const q = supabase
      .from('telegram_manual_access')
      .select('id, user_id, valid_until')
      .in('user_id', userIds)
      .eq('is_active', true)
      .or(`valid_until.is.null,valid_until.gt.${nowStr}`);
    if (clubId) q.eq('club_id', clubId);
    const { data, error } = await q;
    if (error) throw new Error(`commercial_access_manual_failed: ${error.message}`);
    for (const m of data || []) {
      results.set(m.user_id, selectWiderCommercialAccess(results.get(m.user_id), {
        valid: true, source: 'manual_access', endAt: m.valid_until, manualAccessId: m.id,
      }));
    }
  }

  // 4. Billing-day protection (без telegram_*)
  if (userIds.length > 0 && (clubProductIds === null || clubProductIds.length > 0)) {
    const todayKey = toTzDateKey(nowStr, APP_TZ);
    const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);
    const q = supabase
      .from('subscriptions_v2')
      .select('id, user_id, next_charge_at, access_end_at')
      .in('user_id', userIds)
      .eq('billing_type', 'provider_managed')
      .neq('status', 'canceled')
      .gte('next_charge_at', todayStart)
      .lt('next_charge_at', todayEnd);
    if (clubProductIds !== null) q.in('product_id', clubProductIds);
    const { data, error } = await q;
    if (error) throw new Error(`commercial_access_billing_day_failed: ${error.message}`);
    for (const s of data || []) {
      if (s.next_charge_at) {
        const endOfDayUtcMs = new Date(todayEnd).getTime() - 1000;
        if (effectiveNow.getTime() <= endOfDayUtcMs) {
          const protectedUntil = s.access_end_at
            ? new Date(Math.max(new Date(s.access_end_at).getTime(), endOfDayUtcMs)).toISOString()
            : null;
          results.set(s.user_id, selectWiderCommercialAccess(results.get(s.user_id), {
            valid: true, source: 'subscription', endAt: protectedUntil, subscriptionId: s.id,
          }));
        }
      }
    }
  }

  return results;
}
