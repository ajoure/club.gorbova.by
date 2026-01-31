/**
 * PATCH 3: Centralized Access Validation
 * 
 * ЕДИНСТВЕННАЯ реализация hasValidAccess() для всего проекта.
 * Все edge functions должны импортировать из этого файла.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AccessCheckResult {
  valid: boolean;
  source?: 'subscription' | 'entitlement' | 'manual_access';
  endAt?: string | null;
  subscriptionId?: string;
  entitlementId?: string;
  manualAccessId?: string;
}

/**
 * ЕДИНСТВЕННАЯ реализация проверки доступа.
 * 
 * Проверяет 3 источника в порядке приоритета:
 * 1. subscriptions_v2 (status IN ['active', 'trial', 'past_due'] AND access_end_at > now)
 * 2. entitlements (status = 'active' AND (expires_at IS NULL OR expires_at > now))
 * 3. telegram_manual_access (is_active = true AND (valid_until IS NULL OR valid_until > now))
 * 
 * @param supabase - Supabase client with service role
 * @param userId - User ID (auth.users.id)
 * @param now - Optional current timestamp (defaults to new Date())
 */
export async function hasValidAccess(
  supabase: SupabaseClient,
  userId: string,
  now?: Date
): Promise<AccessCheckResult> {
  const nowStr = (now || new Date()).toISOString();

  // 1. Check active subscription
  const { data: activeSub } = await supabase
    .from('subscriptions_v2')
    .select('id, access_end_at')
    .eq('user_id', userId)
    .in('status', ['active', 'trial', 'past_due'])
    .gt('access_end_at', nowStr)
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
  const { data: manualAccess } = await supabase
    .from('telegram_manual_access')
    .select('id, valid_until')
    .eq('user_id', userId)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gt.${nowStr}`)
    .limit(1)
    .maybeSingle();

  if (manualAccess) {
    return {
      valid: true,
      source: 'manual_access',
      endAt: manualAccess.valid_until,
      manualAccessId: manualAccess.id,
    };
  }

  return { valid: false };
}

/**
 * Batch check access for multiple users (set-based, no N+1)
 * Returns a Map of userId -> AccessCheckResult
 */
export async function hasValidAccessBatch(
  supabase: SupabaseClient,
  userIds: string[],
  now?: Date
): Promise<Map<string, AccessCheckResult>> {
  const nowStr = (now || new Date()).toISOString();
  const results = new Map<string, AccessCheckResult>();

  // Initialize all as invalid
  for (const userId of userIds) {
    results.set(userId, { valid: false });
  }

  if (userIds.length === 0) return results;

  // 1. Batch check subscriptions
  const { data: activeSubs } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, access_end_at')
    .in('user_id', userIds)
    .in('status', ['active', 'trial', 'past_due'])
    .gt('access_end_at', nowStr);

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
    const { data: manualAccessList } = await supabase
      .from('telegram_manual_access')
      .select('id, user_id, valid_until')
      .in('user_id', stillWithoutAccess)
      .eq('is_active', true)
      .or(`valid_until.is.null,valid_until.gt.${nowStr}`);

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

  return results;
}
