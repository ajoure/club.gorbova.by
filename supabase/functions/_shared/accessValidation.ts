/**
 * PATCH 3 + P0.9.5: Centralized Access Validation
 * 
 * ЕДИНСТВЕННАЯ реализация hasValidAccess() для всего проекта.
 * Все edge functions должны импортировать из этого файла.
 * 
 * PATCH P0.9.5: Added telegram_access and telegram_access_grants checks
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AccessCheckResult {
  valid: boolean;
  source?: 'subscription' | 'entitlement' | 'manual_access' | 'telegram_access' | 'telegram_grant';
  endAt?: string | null;
  subscriptionId?: string;
  entitlementId?: string;
  manualAccessId?: string;
  telegramAccessId?: string;
  telegramGrantId?: string;
}

/**
 * ЕДИНСТВЕННАЯ реализация проверки доступа.
 * 
 * Проверяет 5 источников в порядке приоритета:
 * 1. subscriptions_v2 (status IN ['active', 'trial', 'past_due'] AND access_end_at > now)
 * 2. entitlements (status = 'active' AND (expires_at IS NULL OR expires_at > now))
 * 3. telegram_manual_access (is_active = true AND (valid_until IS NULL OR valid_until > now))
 * 4. telegram_access (active_until IS NULL OR active_until > now)
 * 5. telegram_access_grants (status = 'active' AND (end_at IS NULL OR end_at > now))
 * 
 * @param supabase - Supabase client with service role
 * @param userId - User ID (auth.users.id)
 * @param clubId - Optional club ID for telegram-specific checks
 * @param now - Optional current timestamp (defaults to new Date())
 */
export async function hasValidAccess(
  supabase: SupabaseClient,
  userId: string,
  clubId?: string,
  now?: Date
): Promise<AccessCheckResult> {
  const nowStr = (now || new Date()).toISOString();

  // 1. Check active subscription (HIGHEST PRIORITY - P0.9.5)
  const { data: activeSub } = await supabase
    .from('subscriptions_v2')
    .select('id, access_end_at')
    .eq('user_id', userId)
    .in('status', ['active', 'trial', 'past_due'])
    .or(`access_end_at.is.null,access_end_at.gt.${nowStr}`)
    .limit(1)
    .maybeSingle();

  if (activeSub) {
    return {
      valid: true,
      source: 'subscription',
      endAt: activeSub.access_end_at,
      subscriptionId: activeSub.id,
    };
  }

  // 2. Check active entitlement
  const { data: activeEntitlement } = await supabase
    .from('entitlements')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${nowStr}`)
    .limit(1)
    .maybeSingle();

  if (activeEntitlement) {
    return {
      valid: true,
      source: 'entitlement',
      endAt: activeEntitlement.expires_at,
      entitlementId: activeEntitlement.id,
    };
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

  // 4. Check telegram_access (P0.9.5)
  const telegramAccessQuery = supabase
    .from('telegram_access')
    .select('id, active_until')
    .eq('user_id', userId)
    .or(`active_until.is.null,active_until.gt.${nowStr}`)
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

  // 5. Check telegram_access_grants (P0.9.5)
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

  return { valid: false };
}

/**
 * Batch check access for multiple users (set-based, no N+1)
 * Returns a Map of userId -> AccessCheckResult
 * 
 * PATCH P0.9.5: Added telegram_access and telegram_access_grants checks
 */
export async function hasValidAccessBatch(
  supabase: SupabaseClient,
  userIds: string[],
  clubId?: string,
  now?: Date
): Promise<Map<string, AccessCheckResult>> {
  const nowStr = (now || new Date()).toISOString();
  const results = new Map<string, AccessCheckResult>();

  // Initialize all as invalid
  for (const userId of userIds) {
    results.set(userId, { valid: false });
  }

  if (userIds.length === 0) return results;

  // 1. Batch check subscriptions (HIGHEST PRIORITY - P0.9.5)
  const { data: activeSubs } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, access_end_at')
    .in('user_id', userIds)
    .in('status', ['active', 'trial', 'past_due'])
    .or(`access_end_at.is.null,access_end_at.gt.${nowStr}`);

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

  // 2. Batch check entitlements (only for users without subscription)
  const usersWithoutAccess = userIds.filter((uid) => !results.get(uid)?.valid);
  if (usersWithoutAccess.length > 0) {
    const { data: activeEntitlements } = await supabase
      .from('entitlements')
      .select('id, user_id, expires_at')
      .in('user_id', usersWithoutAccess)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`);

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

  // 4. Batch check telegram_access (P0.9.5)
  const stillWithoutAccess2 = userIds.filter((uid) => !results.get(uid)?.valid);
  if (stillWithoutAccess2.length > 0) {
    const telegramQuery = supabase
      .from('telegram_access')
      .select('id, user_id, active_until')
      .in('user_id', stillWithoutAccess2)
      .or(`active_until.is.null,active_until.gt.${nowStr}`);
    
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

  // 5. Batch check telegram_access_grants (P0.9.5)
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

  return results;
}
