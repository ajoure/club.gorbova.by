/**
 * Unified effective access resolution helper.
 * 
 * CANONICAL SOURCE OF TRUTH for access dates:
 *   - subscriptions_v2.access_end_at (paid subscription per product)
 *   - entitlements.expires_at (one-off/service access)
 *   - telegram_manual_access.valid_until (manual access)
 * 
 * DERIVED/SYNC (mirrors, NOT SoT):
 *   - telegram_access.active_until
 *   - telegram_access_grants.end_at
 * 
 * NULL = unlimited access (for expires_at/valid_until).
 * 
 * All edge functions MUST use this helper for activeUntil / access window.
 * Self-computation of access dates is PROHIBITED.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { toTzDateKey, dayWindowUtc, APP_TZ } from './timezone.ts';

/** Grace period: 72h after access_end_at, subscription still valid */
const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

export interface AccessSource {
  type: 'subscription' | 'entitlement' | 'manual_access';
  id: string;
  endAt: Date | null; // null = unlimited
  productId: string | null;
  status?: string;
}

export interface EffectiveAccessSnapshot {
  /** Effective end date, null = unlimited */
  effectiveEndAt: Date | null;
  /** True if at least one source gives unlimited access (NULL end) */
  isUnlimited: boolean;
  /** True if billing-day protection is currently active */
  isProtectedByBillingDay: boolean;
  /** The source that provides the latest (or unlimited) access */
  sourceType: 'subscription' | 'entitlement' | 'manual_access' | 'billing_day_protection' | null;
  sourceId: string | null;
  /** All valid sources found */
  allSources: AccessSource[];
}

const EMPTY_SNAPSHOT: EffectiveAccessSnapshot = {
  effectiveEndAt: null,
  isUnlimited: false,
  isProtectedByBillingDay: false,
  sourceType: null,
  sourceId: null,
  allSources: [],
};

/**
 * Resolve effective access end date for a specific club.
 * 
 * Checks ALL product_ids mapped to the club, then entitlements and manual access.
 * Returns the MAX valid date across all sources.
 * If any source is unlimited (NULL), returns isUnlimited=true, effectiveEndAt=null.
 */
export async function resolveEffectiveClubAccess(
  supabase: SupabaseClient,
  userId: string,
  clubId: string,
  now?: Date,
): Promise<EffectiveAccessSnapshot> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  const allSources: AccessSource[] = [];
  let isProtectedByBillingDay = false;

  // 1. Get all active product_ids for this club
  const { data: mappings } = await supabase
    .from('product_club_mappings')
    .select('product_id')
    .eq('club_id', clubId)
    .eq('is_active', true);

  const productIds = (mappings || []).map((m: any) => m.product_id).filter(Boolean);

  // 2. Check subscriptions (with 72h grace)
  if (productIds.length > 0) {
    const graceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();

    const { data: subs } = await supabase
      .from('subscriptions_v2')
      .select('id, access_end_at, product_id, status')
      .eq('user_id', userId)
      .in('product_id', productIds)
      .in('status', ['active', 'trial', 'past_due'])
      .or(`access_end_at.is.null,access_end_at.gt.${graceNowStr}`);

    for (const sub of subs || []) {
      allSources.push({
        type: 'subscription',
        id: sub.id,
        endAt: sub.access_end_at ? new Date(sub.access_end_at) : null,
        productId: sub.product_id,
        status: sub.status,
      });
    }
  }

  // 3. Check entitlements
  if (productIds.length > 0) {
    const { data: ents } = await supabase
      .from('entitlements')
      .select('id, expires_at, product_id, status')
      .eq('user_id', userId)
      .in('product_id', productIds)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${nowStr}`);

    for (const ent of ents || []) {
      allSources.push({
        type: 'entitlement',
        id: ent.id,
        endAt: ent.expires_at ? new Date(ent.expires_at) : null,
        productId: ent.product_id,
        status: ent.status,
      });
    }
  }

  // 4. Check manual access (by club_id directly)
  const { data: manualList } = await supabase
    .from('telegram_manual_access')
    .select('id, valid_until')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gt.${nowStr}`);

  for (const ma of manualList || []) {
    allSources.push({
      type: 'manual_access',
      id: ma.id,
      endAt: ma.valid_until ? new Date(ma.valid_until) : null,
      productId: null,
    });
  }

  // 5. Check billing-day protection
  if (productIds.length > 0) {
    const todayKey = toTzDateKey(nowStr, APP_TZ);
    const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);

    const { data: bdSub } = await supabase
      .from('subscriptions_v2')
      .select('id, next_charge_at, access_end_at, product_id')
      .eq('user_id', userId)
      .in('product_id', productIds)
      .eq('billing_type', 'provider_managed')
      .neq('status', 'canceled')
      .gte('next_charge_at', todayStart)
      .lt('next_charge_at', todayEnd)
      .limit(1)
      .maybeSingle();

    if (bdSub?.next_charge_at) {
      // Protection until end of billing day (23:59:59 APP_TZ)
      const endOfDayUtc = new Date(new Date(todayEnd).getTime() - 1000); // todayEnd is midnight next day, -1s = 23:59:59
      if (effectiveNow < endOfDayUtc) {
        isProtectedByBillingDay = true;
        // Add as a synthetic source with end = end of day
        // But only if no other source already covers this period
        const alreadyCovered = allSources.some(s =>
          s.endAt === null || (s.endAt && s.endAt >= endOfDayUtc)
        );
        if (!alreadyCovered) {
          allSources.push({
            type: 'subscription',
            id: bdSub.id,
            endAt: endOfDayUtc,
            productId: bdSub.product_id,
            status: 'billing_day_protected',
          });
        }
      }
    }
  }

  // 6. Resolve effective end date
  if (allSources.length === 0) {
    return { ...EMPTY_SNAPSHOT };
  }

  // Check for unlimited (NULL endAt)
  const unlimitedSource = allSources.find(s => s.endAt === null);
  if (unlimitedSource) {
    return {
      effectiveEndAt: null,
      isUnlimited: true,
      isProtectedByBillingDay,
      sourceType: unlimitedSource.type,
      sourceId: unlimitedSource.id,
      allSources,
    };
  }

  // Find MAX endAt
  let maxSource = allSources[0];
  for (const s of allSources) {
    if (s.endAt && (!maxSource.endAt || s.endAt > maxSource.endAt)) {
      maxSource = s;
    }
  }

  return {
    effectiveEndAt: maxSource.endAt,
    isUnlimited: false,
    isProtectedByBillingDay,
    sourceType: maxSource.type,
    sourceId: maxSource.id,
    allSources,
  };
}

/**
 * Resolve effective access end date for a specific product.
 * Similar to club access, but without club-level manual access.
 */
export async function resolveEffectiveProductAccess(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  now?: Date,
): Promise<EffectiveAccessSnapshot> {
  const effectiveNow = now || new Date();
  const nowStr = effectiveNow.toISOString();
  const allSources: AccessSource[] = [];
  let isProtectedByBillingDay = false;

  // Grace
  const graceNowStr = new Date(effectiveNow.getTime() - GRACE_PERIOD_MS).toISOString();

  // 1. Subscriptions
  const { data: subs } = await supabase
    .from('subscriptions_v2')
    .select('id, access_end_at, product_id, status')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .in('status', ['active', 'trial', 'past_due'])
    .or(`access_end_at.is.null,access_end_at.gt.${graceNowStr}`);

  for (const sub of subs || []) {
    allSources.push({
      type: 'subscription',
      id: sub.id,
      endAt: sub.access_end_at ? new Date(sub.access_end_at) : null,
      productId: sub.product_id,
      status: sub.status,
    });
  }

  // 2. Entitlements
  const { data: ents } = await supabase
    .from('entitlements')
    .select('id, expires_at, product_id, status')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${nowStr}`);

  for (const ent of ents || []) {
    allSources.push({
      type: 'entitlement',
      id: ent.id,
      endAt: ent.expires_at ? new Date(ent.expires_at) : null,
      productId: ent.product_id,
      status: ent.status,
    });
  }

  // 3. Billing-day protection
  const todayKey = toTzDateKey(nowStr, APP_TZ);
  const { start: todayStart, end: todayEnd } = dayWindowUtc(APP_TZ, todayKey);

  const { data: bdSub } = await supabase
    .from('subscriptions_v2')
    .select('id, next_charge_at, access_end_at')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .eq('billing_type', 'provider_managed')
    .neq('status', 'canceled')
    .gte('next_charge_at', todayStart)
    .lt('next_charge_at', todayEnd)
    .limit(1)
    .maybeSingle();

  if (bdSub?.next_charge_at) {
    const endOfDayUtc = new Date(new Date(todayEnd).getTime() - 1000);
    if (effectiveNow < endOfDayUtc) {
      isProtectedByBillingDay = true;
      const alreadyCovered = allSources.some(s =>
        s.endAt === null || (s.endAt && s.endAt >= endOfDayUtc)
      );
      if (!alreadyCovered) {
        allSources.push({
          type: 'subscription',
          id: bdSub.id,
          endAt: endOfDayUtc,
          productId,
          status: 'billing_day_protected',
        });
      }
    }
  }

  // Resolve
  if (allSources.length === 0) {
    return { ...EMPTY_SNAPSHOT };
  }

  const unlimitedSource = allSources.find(s => s.endAt === null);
  if (unlimitedSource) {
    return {
      effectiveEndAt: null,
      isUnlimited: true,
      isProtectedByBillingDay,
      sourceType: unlimitedSource.type,
      sourceId: unlimitedSource.id,
      allSources,
    };
  }

  let maxSource = allSources[0];
  for (const s of allSources) {
    if (s.endAt && (!maxSource.endAt || s.endAt > maxSource.endAt)) {
      maxSource = s;
    }
  }

  return {
    effectiveEndAt: maxSource.endAt,
    isUnlimited: false,
    isProtectedByBillingDay,
    sourceType: maxSource.type,
    sourceId: maxSource.id,
    allSources,
  };
}

/**
 * Format effective access snapshot for use in mirrors/audit.
 * Returns ISO string or null (unlimited).
 */
export function effectiveEndAtIso(snapshot: EffectiveAccessSnapshot): string | null {
  if (snapshot.isUnlimited) return null;
  return snapshot.effectiveEndAt?.toISOString() || null;
}
