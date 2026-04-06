/**
 * Shared entitlement-sync helper — v23.1.9D + v23.1.10
 * 
 * Single source of truth for entitlement upsert logic.
 * Called from: handle_new_user (SQL inline version), subscription-charge,
 *              subscription-admin-actions, subscription-actions.
 * 
 * Contract:
 * - INSERT ... ON CONFLICT (user_id, product_code) DO UPDATE
 * - expires_at = GREATEST(existing, new) — never decrease
 * - Writes audit_logs with actor_type='system'
 * - Skips if product_code is empty/null
 * - Skips cb20 when called from subscription paths (mode_filter)
 */

// PATCH-ID-FIRST-HIGH-RISK-EXECUTE: Hardcoded sets kept ONLY as fallback for products
// without entitlement_mode in DB. Primary source: products_v2.entitlement_mode column.
const FALLBACK_SUBSCRIPTION_BASED_CODES = new Set([
  'club',
  'buh_business',
  'cb_module_ip',
  'prd_0d01a2fdc477',
  'course_close_year',
  '1769009596189-398a',
]);

const FALLBACK_ORDER_BASED_ONLY_CODES = new Set([
  'cb20',
]);

const FALLBACK_LEGACY_SKIP_CODES = new Set([
  'cb_2_step',
]);

/**
 * Resolve entitlement mode from DB (products_v2.entitlement_mode).
 * Falls back to hardcoded sets if product not found or entitlement_mode is NULL.
 */
async function resolveEntitlementMode(
  supabase: any,
  product_code: string,
  product_id?: string | null,
): Promise<'subscription_based' | 'order_based_only' | 'legacy_skip' | 'unknown'> {
  // Try DB lookup first (by product_id or product_code)
  if (product_id) {
    const { data } = await supabase
      .from('products_v2')
      .select('entitlement_mode')
      .eq('id', product_id)
      .maybeSingle();
    if (data?.entitlement_mode) return data.entitlement_mode;
  }
  if (product_code) {
    const { data } = await supabase
      .from('products_v2')
      .select('entitlement_mode')
      .eq('code', product_code)
      .maybeSingle();
    if (data?.entitlement_mode) return data.entitlement_mode;
  }

  // Fallback to hardcoded sets (transitional)
  if (FALLBACK_LEGACY_SKIP_CODES.has(product_code)) return 'legacy_skip';
  if (FALLBACK_ORDER_BASED_ONLY_CODES.has(product_code)) return 'order_based_only';
  if (FALLBACK_SUBSCRIPTION_BASED_CODES.has(product_code)) return 'subscription_based';
  return 'unknown';
}

export type SyncSource =
  | 'subscription_renewal'
  | 'profile_claim'
  | 'admin_action'
  | 'admin_extend'
  | 'admin_grant'
  | 'admin_set_end_date'
  | 'user_resume'
  | 'historical_backfill';

export type SyncModeFilter =
  | 'subscription_based'  // Only sync subscription-based products
  | 'all';                // Sync all (used by backfill/claim for sub-based only)

export interface SyncEntitlementParams {
  supabase: any;
  user_id: string;
  profile_id?: string | null;
  product_id?: string | null;
  product_code: string | null | undefined;
  access_end_at: string | null | undefined;
  source: SyncSource;
  order_id?: string | null;
  subscription_id?: string | null;
  actor_label: string;
  batch_id?: string | null;
  mode_filter?: SyncModeFilter;
}

export interface SyncEntitlementResult {
  action: 'inserted' | 'updated' | 'skipped';
  entitlement_id?: string;
  skip_reason?: string;
}

/**
 * Check if there are other active access sources for a given user+product_code.
 * Used as pre-revoke guard in subscription-admin-actions.
 */
export async function hasOtherActiveAccessSource(
  supabase: any,
  user_id: string,
  product_code: string,
  excluding_subscription_id?: string,
): Promise<{ has_other: boolean; sources: string[] }> {
  const sources: string[] = [];

  // 1. Check other active subscriptions for same product_code
  let subQuery = supabase
    .from('subscriptions_v2')
    .select('id, status, product_id, products_v2!inner(code)')
    .eq('user_id', user_id)
    .in('status', ['active', 'trial'])
    .eq('products_v2.code', product_code);

  if (excluding_subscription_id) {
    subQuery = subQuery.neq('id', excluding_subscription_id);
  }

  const { data: otherSubs } = await subQuery.limit(1);
  if (otherSubs && otherSubs.length > 0) {
    sources.push(`subscription:${otherSubs[0].id}`);
  }

  // 2. Check if product is order-based — never revoke from subscription path
  // PATCH-ID-FIRST: Use DB-driven mode resolution
  const mode = await resolveEntitlementMode(supabase, product_code);
  if (mode === 'order_based_only') {
    sources.push('order_based_product');
  }

  // 3. Check for active entitlement with non-subscription source
  const { data: otherEntitlements } = await supabase
    .from('entitlements')
    .select('id, meta')
    .eq('user_id', user_id)
    .eq('product_code', product_code)
    .eq('status', 'active')
    .limit(5);

  if (otherEntitlements) {
    for (const ent of otherEntitlements) {
      const entSource = (ent.meta as any)?.source;
      if (entSource && !['subscription_renewal', 'admin_action'].includes(entSource)) {
        sources.push(`entitlement:${ent.id}:source=${entSource}`);
      }
    }
  }

  return { has_other: sources.length > 0, sources };
}

/**
 * Main entitlement sync function.
 * Upserts entitlement with ON CONFLICT (user_id, product_code).
 * Never decreases expires_at.
 */
export async function syncEntitlement(params: SyncEntitlementParams): Promise<SyncEntitlementResult> {
  const {
    supabase,
    user_id,
    profile_id,
    product_id,
    product_code,
    access_end_at,
    source,
    order_id,
    subscription_id,
    actor_label,
    batch_id,
    mode_filter = 'subscription_based',
  } = params;

  // Guard: skip if product_code is empty
  if (!product_code || product_code.trim() === '') {
    return { action: 'skipped', skip_reason: 'empty_product_code' };
  }

  // PATCH-ID-FIRST: DB-driven entitlement mode resolution
  const entitlementMode = await resolveEntitlementMode(supabase, product_code, product_id);

  // Guard: skip legacy codes
  if (entitlementMode === 'legacy_skip') {
    return { action: 'skipped', skip_reason: 'legacy_code_mismatch' };
  }

  // Guard: mode_filter — subscription paths must not touch order-based products
  if (mode_filter === 'subscription_based' && entitlementMode === 'order_based_only') {
    return { action: 'skipped', skip_reason: 'order_based_only_product' };
  }

  // Guard: if mode_filter is subscription_based, only allow known subscription codes
  if (mode_filter === 'subscription_based' && entitlementMode !== 'subscription_based') {
    return { action: 'skipped', skip_reason: 'unknown_product_code_for_subscription_sync' };
  }

  const now = new Date().toISOString();
  const meta = {
    source,
    source_patch: 'v23.1.10',
    actor_label,
    ...(batch_id ? { batch_id } : {}),
    ...(subscription_id ? { subscription_id } : {}),
    ...(order_id ? { order_id } : {}),
    synced_at: now,
  };

  // Check existing entitlement
  const { data: existing } = await supabase
    .from('entitlements')
    .select('id, expires_at, status, meta')
    .eq('user_id', user_id)
    .eq('product_code', product_code)
    .maybeSingle();

  if (existing) {
    // UPDATE path — never decrease expires_at
    const existingExpiry = existing.expires_at ? new Date(existing.expires_at).getTime() : 0;
    const newExpiry = access_end_at ? new Date(access_end_at).getTime() : 0;
    const effectiveExpiry = newExpiry > existingExpiry ? access_end_at : existing.expires_at;

    // Merge meta
    const existingMeta = (existing.meta as Record<string, unknown>) || {};
    const mergedMeta = { ...existingMeta, ...meta };

    const updateData: Record<string, unknown> = {
      status: 'active',
      expires_at: effectiveExpiry,
      meta: mergedMeta,
      updated_at: now,
    };
    if (product_id) updateData.product_id = product_id;
    if (profile_id) updateData.profile_id = profile_id;
    if (order_id) updateData.order_id = order_id;

    const { error: updateError } = await supabase
      .from('entitlements')
      .update(updateData)
      .eq('id', existing.id);

    if (updateError) {
      console.error(`[entitlement-sync] Update failed for ${user_id}/${product_code}:`, updateError);
      return { action: 'skipped', skip_reason: `update_error: ${updateError.message}` };
    }

    // Audit
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label,
      action: 'entitlement.synced',
      target_user_id: user_id,
      meta: {
        entitlement_id: existing.id,
        product_code,
        product_id,
        sync_action: 'updated',
        source,
        previous_expires_at: existing.expires_at,
        new_expires_at: effectiveExpiry,
        expires_at_changed: effectiveExpiry !== existing.expires_at,
        subscription_id,
        batch_id,
      },
    });

    console.log(`[entitlement-sync] Updated ${product_code} for user ${user_id}, expires_at=${effectiveExpiry}`);
    return { action: 'updated', entitlement_id: existing.id };
  } else {
    // INSERT path
    const insertData: Record<string, unknown> = {
      user_id,
      product_code,
      status: 'active',
      expires_at: access_end_at || null,
      meta,
    };
    if (product_id) insertData.product_id = product_id;
    if (profile_id) insertData.profile_id = profile_id;
    if (order_id) insertData.order_id = order_id;

    const { data: inserted, error: insertError } = await supabase
      .from('entitlements')
      .insert(insertData)
      .select('id')
      .single();

    if (insertError) {
      // Could be a race condition — try update instead
      if (insertError.code === '23505') {
        // Unique constraint violation — entitlement was created between check and insert
        console.log(`[entitlement-sync] Race condition for ${user_id}/${product_code}, retrying as update`);
        return syncEntitlement({ ...params }); // Recursive retry (will hit UPDATE path)
      }
      console.error(`[entitlement-sync] Insert failed for ${user_id}/${product_code}:`, insertError);
      return { action: 'skipped', skip_reason: `insert_error: ${insertError.message}` };
    }

    // Audit
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label,
      action: 'entitlement.synced',
      target_user_id: user_id,
      meta: {
        entitlement_id: inserted.id,
        product_code,
        product_id,
        sync_action: 'inserted',
        source,
        expires_at: access_end_at,
        subscription_id,
        batch_id,
      },
    });

    console.log(`[entitlement-sync] Inserted ${product_code} for user ${user_id}, expires_at=${access_end_at}`);
    return { action: 'inserted', entitlement_id: inserted.id };
  }
}
