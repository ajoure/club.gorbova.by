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
import {
  accessBearingSubscriptionFilter,
  hasCommercialAccess,
} from './accessValidation.ts';

/** Grace period: 72h after access_end_at, subscription still valid */
const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

export interface AccessSource {
  type:
    | 'subscription'
    | 'entitlement'
    | 'entitlement_source'
    | 'manual_access'
    | 'paid_order_rule';
  id: string;
  endAt: Date | null; // null = unlimited
  productId: string | null;
  tariffId?: string | null;
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
  sourceType:
    | 'subscription'
    | 'entitlement'
    | 'entitlement_source'
    | 'manual_access'
    | 'paid_order_rule'
    | 'billing_day_protection'
    | null;
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
  const resolved = await hasCommercialAccess(supabase, userId, clubId, now);
  if (!resolved.valid || !resolved.source) return { ...EMPTY_SNAPSHOT };

  const sourceId = resolved.subscriptionId || resolved.entitlementId ||
    resolved.manualAccessId || resolved.orderId || null;
  const endAt = resolved.endAt ? new Date(resolved.endAt) : null;
  const source: AccessSource = {
    type: resolved.source as AccessSource['type'],
    id: sourceId || 'resolved-commercial-source',
    endAt,
    productId: null,
  };

  return {
    effectiveEndAt: endAt,
    isUnlimited: resolved.endAt === null,
    isProtectedByBillingDay: false,
    sourceType: source.type,
    sourceId,
    allSources: [source],
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
    .select('id, access_end_at, product_id, tariff_id, status')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .in('status', ['active', 'trial', 'past_due', 'canceled'])
    .or(accessBearingSubscriptionFilter(graceNowStr));

  for (const sub of subs || []) {
    allSources.push({
      type: 'subscription',
      id: sub.id,
      endAt: sub.access_end_at ? new Date(sub.access_end_at) : null,
      productId: sub.product_id,
      tariffId: sub.tariff_id,
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

  // 3. Tier-aware entitlement sources
  //
  // The aggregate entitlement intentionally keeps only the widest product
  // window. Exact tariff identity lives on entitlement_sources. In
  // particular, a paid course can grant a finite Gorbova Club BUSINESS bonus
  // without creating a Club subscription. Live-event tariff rules must be
  // able to prove that configured target tariff without trusting a generic
  // product entitlement.
  const { data: entitlementSources } = await supabase
    .from('entitlement_sources')
    .select('id, expires_at, product_id, tariff_id, status')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .eq('status', 'active')
    .lte('starts_at', nowStr)
    .or(`expires_at.is.null,expires_at.gt.${nowStr}`);

  for (const source of entitlementSources || []) {
    allSources.push({
      type: 'entitlement_source',
      id: source.id,
      endAt: source.expires_at ? new Date(source.expires_at) : null,
      productId: source.product_id,
      tariffId: source.tariff_id,
      status: source.status,
    });
  }

  // 4. Billing-day protection
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
