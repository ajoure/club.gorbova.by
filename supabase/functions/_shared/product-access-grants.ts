/**
 * Shared engine for SECONDARY product_access grants.
 *
 * SOT: access_rules with grant_target_type='product_access'.
 *      Resolution order = tariff-level rules first, product-level fallback.
 *      All matching by UUID — no string/slug/code heuristics.
 *
 * Used by:
 *   - grant-access-for-order        (webhook / paid order fulfillment)
 *   - access-rules-nightly-reconcile (cron, 03:00 Minsk)
 *   - rules-retroapply              (admin manual)
 *
 * Contract:
 *   - Idempotent. Re-running on the same (user, source product/tariff) MUST NOT create duplicates
 *     and MUST NOT decrease entitlements.expires_at.
 *   - GREATEST(existing.expires_at, planned) for active entitlements.
 *   - Reactivate expired entitlements ONLY when safe lineage detected
 *     (rule_engine_product_access | retroapply | source_rule_id present | no manual override).
 *   - Never automatically reduces access_end (allow_reduce_access flag opt-in).
 *   - Writes one access_grant_ledger row per (user × target_product × rule).
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { writeLedgerEntry, type LedgerSourceEventType, type LedgerSourceSubjectType } from './fulfillment-executor.ts';
import { checkPriorPurchase } from './check-prior-purchase.ts';

export type SecondaryGrantOutcome =
  | 'granted'        // new entitlement created
  | 'reactivated'    // expired→active reactivation (safe lineage)
  | 'extended'       // expires_at updated to a larger value
  | 'already_satisfied' // entitlement already covers planned window
  | 'metadata_backfilled' // already_satisfied + safe meta backfill applied (expires_at/status untouched)
  | 'condition_not_met'  // prior_purchase failed
  | 'no_source_window'   // align_with_source but no active source subscription
  | 'conflict_manual'    // existing entitlement has manual lineage — do not touch
  | 'conflict_other_rule' // entitlement was issued by a different rule
  | 'conflict_multiple'   // user has >1 active entitlement for this product
  | 'skipped_no_change'
  | 'skipped_disabled'
  | 'failed';

export interface SecondaryGrantAction {
  user_id: string;
  profile_id: string | null;
  source_product_id: string;
  source_tariff_id: string | null;
  source_subscription_id: string | null;
  source_access_end_at: string | null;
  rule_id: string;
  target_product_id: string;
  target_product_code: string | null;
  outcome: SecondaryGrantOutcome;
  reason?: string;
  current_expires_at: string | null;
  planned_expires_at: string | null;
  ledger_id?: string | null;
  ledger_execution_key?: string | null;
}

export interface SecondaryGrantContext {
  /** Origin of the call — webhook / cron / admin */
  sourceEventType: LedgerSourceEventType;
  sourceSubjectType: LedgerSourceSubjectType;
  /** A deterministic key prefix used to build per-action source_event_key */
  sourceEventKeyPrefix: string;
  /** The original order id that triggered the call (if any) */
  orderId?: string | null;
  /** Lineage propagation */
  parentEventKey?: string | null;
  parentExecutionKey?: string | null;
  /** When true, helper is allowed to reduce existing expires_at down to planned window. */
  allowReduceAccess?: boolean;
  /** When true, helper will NOT mutate, only classify (preview/dry-run). */
  dryRun?: boolean;
}

interface InternalRule {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  duration_days: number | null;
  conditions: Record<string, any>;
  scope: 'tariff' | 'product';
}

const SAFE_META_KEYS = [
  'source_type',
  'source_rule_id',
  'granted_by',
  'business_subscription_id',
  'retroapply',
  'retroapply_updated',
  'retroapply_reactivated',
  'batch_id',
];

/**
 * Resolve list of product_access rules for a (source_product, source_tariff).
 * Tariff-level rules take precedence — when present, product-level rules of the same product
 * are NOT added (consistent with grant-access-for-order behavior).
 */
export async function resolveProductAccessRules(
  supabase: SupabaseClient,
  sourceProductId: string,
  sourceTariffId: string | null,
): Promise<InternalRule[]> {
  let rules: InternalRule[] = [];

  if (sourceTariffId) {
    const { data } = await supabase
      .from('access_rules')
      .select('id, product_id, tariff_id, duration_days, conditions, priority')
      .eq('tariff_id', sourceTariffId)
      .eq('grant_target_type', 'product_access')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (data?.length) {
      rules = data.map((r: any) => ({
        id: r.id,
        product_id: r.product_id,
        tariff_id: r.tariff_id,
        duration_days: r.duration_days,
        conditions: r.conditions || {},
        scope: 'tariff',
      }));
    }
  }

  if (rules.length === 0 && sourceProductId) {
    const { data } = await supabase
      .from('access_rules')
      .select('id, product_id, tariff_id, duration_days, conditions, priority')
      .eq('product_id', sourceProductId)
      .is('tariff_id', null)
      .eq('grant_target_type', 'product_access')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (data?.length) {
      rules = data.map((r: any) => ({
        id: r.id,
        product_id: r.product_id,
        tariff_id: r.tariff_id,
        duration_days: r.duration_days,
        conditions: r.conditions || {},
        scope: 'product',
      }));
    }
  }

  return rules;
}

/**
 * Information about a prior paid purchase for a single (user, target_product_id).
 * Captured during batch cache build so the helper can enrich entitlement.meta
 * for the runtime read-path (scope_resolution_mode, historical_module_product_ids).
 */
export interface PriorPurchaseInfo {
  match_type: 'direct' | 'module_list_mapped';
  order_id: string;
  historical_purchase_type: string | null;
  historical_tariff_id: string | null;
  historical_module_product_ids: string[];
}

export type PriorPurchaseCache = Map<string, Map<string, PriorPurchaseInfo>>;

/**
 * Batch-build prior_purchase cache for a cohort.
 * SOT: orders_v2.status='paid' only. NEVER reads entitlements/access_rules.
 *
 * Two evidence channels (both UUID-only, NEVER name/slug):
 *   1. Direct match: orders_v2.product_id = target_product_id
 *   2. Module fallback: purchase_snapshot.historical_purchase_type='module_only_standalone'
 *      AND purchase_snapshot.module_list_mapped contains target_product_id
 *
 * @param userIds   All users to evaluate.
 * @param productIds All product_ids that may appear in any rule's required_product_ids
 *                   or as targets of per_product mode.
 * @param excludeOrderId  If provided, that order_id is excluded (e.g., the very order being processed).
 * @returns PriorPurchaseCache: Map<user_id, Map<target_product_id, PriorPurchaseInfo>>
 */
export async function buildPriorPurchaseCache(
  supabase: SupabaseClient,
  userIds: string[],
  productIds: string[],
  excludeOrderId?: string,
): Promise<PriorPurchaseCache> {
  const cache: PriorPurchaseCache = new Map();
  if (userIds.length === 0 || productIds.length === 0) return cache;

  const uniqueUsers = [...new Set(userIds.filter((u): u is string => !!u))];
  const uniqueProducts = [...new Set(productIds.filter((p): p is string => !!p))];

  // Priority order (highest → lowest):
  //   1. direct + base_tariff_purchase / historical_tariff_id present (full parent purchase)
  //   2. direct + module_only_standalone (module-of-parent standalone purchase)
  //   3. module_list_mapped (Channel 2 fallback)
  // INV-PHANTOM-PARENT-V1: when a user has BOTH a base purchase and a module_only_standalone
  // purchase recorded against the same parent product, the base purchase MUST win — otherwise
  // the entitlement is enriched with module_scope_only/historical_module_product_ids that
  // point outside the parent's training subtree, producing a phantom parent-entitlement that
  // hides the parent course from "Моя библиотека".
  const priorityRank = (info: PriorPurchaseInfo): number => {
    if (info.match_type === 'direct') {
      const isBase = info.historical_purchase_type === 'base_tariff_purchase'
        || (!!info.historical_tariff_id && info.historical_purchase_type !== 'module_only_standalone');
      return isBase ? 3 : 2;
    }
    return 1; // module_list_mapped
  };
  const recordInfo = (userId: string, productId: string, info: PriorPurchaseInfo) => {
    if (!cache.has(userId)) cache.set(userId, new Map());
    const userMap = cache.get(userId)!;
    const existing = userMap.get(productId);
    if (!existing || priorityRank(info) > priorityRank(existing)) {
      userMap.set(productId, info);
    }
  };

  // Chunk users to keep IN-list manageable
  const CHUNK = 500;
  for (let i = 0; i < uniqueUsers.length; i += CHUNK) {
    const slice = uniqueUsers.slice(i, i + CHUNK);

    // ── Channel 1: direct product match ─────────────────────────────────
    {
      let q = supabase
        .from('orders_v2')
        .select('user_id, product_id, id, tariff_id, purchase_snapshot')
        .eq('status', 'paid')
        .in('user_id', slice)
        .in('product_id', uniqueProducts);
      if (excludeOrderId) q = q.neq('id', excludeOrderId);

      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data || [];
        for (const row of rows as Array<{
          user_id: string; product_id: string; id: string;
          tariff_id: string | null; purchase_snapshot: Record<string, any> | null;
        }>) {
          if (!row.user_id || !row.product_id) continue;
          const snapshot = row.purchase_snapshot || {};
          recordInfo(row.user_id, row.product_id, {
            match_type: 'direct',
            order_id: row.id,
            historical_purchase_type: snapshot.historical_purchase_type
              || (row.tariff_id ? 'base_tariff_purchase' : null),
            historical_tariff_id: row.tariff_id || (snapshot.tariff_id || null),
            historical_module_product_ids: Array.isArray(snapshot.module_list_mapped)
              ? snapshot.module_list_mapped : [],
          });
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }

    // ── Channel 2: module_list_mapped fallback ──────────────────────────
    // For each target product_id, check if any paid module-only standalone order
    // contains it in purchase_snapshot.module_list_mapped (UUID match).
    // Use containment per product to leverage JSONB index.
    for (const targetProdId of uniqueProducts) {
      let q = supabase
        .from('orders_v2')
        .select('user_id, product_id, id, tariff_id, purchase_snapshot')
        .eq('status', 'paid')
        .in('user_id', slice)
        .eq('purchase_snapshot->>historical_purchase_type', 'module_only_standalone')
        .contains('purchase_snapshot', { module_list_mapped: [targetProdId] });
      if (excludeOrderId) q = q.neq('id', excludeOrderId);

      const { data, error } = await q.range(0, 999);
      if (error) {
        console.error('[product-access-grants] module fallback query error:', error.message);
        continue;
      }
      for (const row of (data || []) as Array<{
        user_id: string; product_id: string; id: string;
        tariff_id: string | null; purchase_snapshot: Record<string, any> | null;
      }>) {
        if (!row.user_id) continue;
        const snapshot = row.purchase_snapshot || {};
        const moduleList = Array.isArray(snapshot.module_list_mapped) ? snapshot.module_list_mapped : [];
        // Confirm UUID containment (defensive — query already filtered)
        if (!moduleList.includes(targetProdId)) continue;
        recordInfo(row.user_id, targetProdId, {
          match_type: 'module_list_mapped',
          order_id: row.id,
          historical_purchase_type: 'module_only_standalone',
          historical_tariff_id: row.tariff_id || (snapshot.tariff_id || null),
          historical_module_product_ids: moduleList,
        });
      }
    }
  }

  return cache;
}

/** Collect all product_ids referenced by a rule list (required_product_ids + per_product targets). */
export function collectPriorPurchaseProductIds(rules: InternalRule[]): string[] {
  const ids = new Set<string>();
  for (const r of rules) {
    const cond = r.conditions || {};
    if (cond.condition_type !== 'prior_purchase') continue;
    const reqList: string[] = Array.isArray(cond.required_product_ids)
      ? cond.required_product_ids
      : cond.required_product_id ? [cond.required_product_id] : [];
    for (const id of reqList) if (typeof id === 'string') ids.add(id);
    // per_product: also include target_product_ids
    if ((cond.match_mode || 'any') === 'per_product') {
      for (const tid of resolveTargetProductIds(r)) ids.add(tid);
    }
  }
  return [...ids];
}

/** Extract canonical UUID list of target products from rule.conditions / target_ref. */
export function resolveTargetProductIds(rule: InternalRule, ruleTargetRef?: string | null): string[] {
  const cond = rule.conditions || {};
  if (Array.isArray(cond.target_product_ids)) {
    return cond.target_product_ids.filter((id: any) => typeof id === 'string' && id.length > 0);
  }
  if (ruleTargetRef) return [ruleTargetRef];
  return [];
}

/**
 * Run helper for a single (user × source subscription).
 * Returns one SecondaryGrantAction per (rule × target_product).
 */
export async function syncSecondaryProductAccessForUser(
  supabase: SupabaseClient,
  params: {
    userId: string;
    profileId?: string | null;
    sourceProductId: string;
    sourceTariffId: string | null;
    sourceSubscription: { id: string; access_end_at: string | null } | null;
    rules: InternalRule[];
    excludeOrderId?: string;
    /**
     * Optional pre-built prior_purchase cache to avoid N+1 queries.
     * Key = userId, Value = Map<target_product_id, PriorPurchaseInfo>.
     * If not provided, helper falls back to per-product checkPriorPurchase (single webhook flow).
     */
    priorPurchaseCache?: PriorPurchaseCache;
    ctx: SecondaryGrantContext;
  },
): Promise<SecondaryGrantAction[]> {
  const { userId, profileId, sourceProductId, sourceTariffId, sourceSubscription, rules, ctx, priorPurchaseCache } = params;
  const excludeOrderId = params.excludeOrderId || '00000000-0000-0000-0000-000000000000';
  const userPaidMap = priorPurchaseCache?.get(userId) ?? null;

  const getPriorFromCache = (productId: string): PriorPurchaseInfo | null => {
    return userPaidMap ? (userPaidMap.get(productId) ?? null) : null;
  };
  const hasPriorFromCache = (productId: string): boolean => !!getPriorFromCache(productId);

  const out: SecondaryGrantAction[] = [];
  if (rules.length === 0) return out;

  // Pre-fetch target product codes (small set per rule list)
  const allTargets = new Set<string>();
  for (const r of rules) {
    for (const tid of resolveTargetProductIds(r)) allTargets.add(tid);
  }
  const productCodeMap = new Map<string, string>();
  if (allTargets.size > 0) {
    const { data: prods } = await supabase
      .from('products_v2')
      .select('id, code')
      .in('id', [...allTargets]);
    (prods || []).forEach((p: any) => productCodeMap.set(p.id, p.code || ''));
  }

  for (const rule of rules) {
    const targetProductIds = resolveTargetProductIds(rule);
    if (targetProductIds.length === 0) continue;

    const conditions = rule.conditions || {};
    const hasPriorPurchase = conditions.condition_type === 'prior_purchase';

    for (const targetProdId of targetProductIds) {
      const action: SecondaryGrantAction = {
        user_id: userId,
        profile_id: profileId || null,
        source_product_id: sourceProductId,
        source_tariff_id: sourceTariffId,
        source_subscription_id: sourceSubscription?.id || null,
        source_access_end_at: sourceSubscription?.access_end_at || null,
        rule_id: rule.id,
        target_product_id: targetProdId,
        target_product_code: productCodeMap.get(targetProdId) || null,
        outcome: 'failed',
        current_expires_at: null,
        planned_expires_at: null,
      };

      // 1. Per-product prior purchase check (when applicable)
      let priorInfo: PriorPurchaseInfo | null = null;
      if (hasPriorPurchase) {
        const matchMode = conditions.match_mode || 'any';
        const reqList: string[] = Array.isArray(conditions.required_product_ids)
          ? conditions.required_product_ids
          : conditions.required_product_id ? [conditions.required_product_id] : [];

        let conditionMet = false;
        if (matchMode === 'per_product') {
          // For per_product, the prior purchase must match this specific target product
          if (reqList.length === 0 || reqList.includes(targetProdId)) {
            if (priorPurchaseCache) {
              priorInfo = getPriorFromCache(targetProdId);
              conditionMet = !!priorInfo;
            } else {
              const r = await checkPriorPurchase(supabase, userId, targetProdId, excludeOrderId);
              conditionMet = r.found;
              if (r.found && r.order_data) {
                const snap = r.order_data.purchase_snapshot || {};
                priorInfo = {
                  match_type: r.match_type as 'direct' | 'module_list_mapped',
                  order_id: r.order_id!,
                  historical_purchase_type: snap.historical_purchase_type
                    || (r.order_data.tariff_id ? 'base_tariff_purchase' : null),
                  historical_tariff_id: r.order_data.tariff_id || (snap.tariff_id || null),
                  historical_module_product_ids: Array.isArray(snap.module_list_mapped)
                    ? snap.module_list_mapped : [],
                };
              }
            }
          }
        } else {
          // any/all
          if (reqList.length === 0) {
            conditionMet = true;
          } else if (priorPurchaseCache) {
            if (matchMode === 'all') {
              conditionMet = reqList.every((id) => hasPriorFromCache(id));
            } else {
              conditionMet = reqList.some((id) => hasPriorFromCache(id));
            }
          } else {
            for (const reqId of reqList) {
              const r = await checkPriorPurchase(supabase, userId, reqId, excludeOrderId);
              if (matchMode === 'any' && r.found) { conditionMet = true; break; }
              if (matchMode === 'all' && !r.found) { conditionMet = false; break; }
              if (matchMode === 'all') conditionMet = true;
            }
          }
        }

        if (!conditionMet) {
          action.outcome = 'condition_not_met';
          action.reason = 'prior_purchase_failed';
          out.push(action);
          await writeSkipLedger(supabase, ctx, action, 'no_matching_target');
          continue;
        }
      }

      // 2. Calculate planned expires_at
      let planned: string | null = null;
      if (rule.duration_days) {
        planned = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
      } else if (sourceSubscription?.access_end_at) {
        planned = sourceSubscription.access_end_at;
      }
      action.planned_expires_at = planned;

      if (!planned && !rule.duration_days) {
        action.outcome = 'no_source_window';
        action.reason = 'no_active_source_subscription';
        out.push(action);
        await writeSkipLedger(supabase, ctx, action, 'no_matching_target');
        continue;
      }

      // 3. Existing entitlement(s) for (user, target_product)
      const { data: existingList } = await supabase
        .from('entitlements')
        .select('id, status, expires_at, meta, profile_id, order_id, product_code')
        .eq('user_id', userId)
        .eq('product_id', targetProdId);

      const existing = (existingList || []);
      action.current_expires_at = existing[0]?.expires_at || null;

      if (existing.filter(e => e.status === 'active').length > 1) {
        action.outcome = 'conflict_multiple';
        action.reason = 'multiple_active_entitlements';
        out.push(action);
        await writeSkipLedger(supabase, ctx, action, 'duplicate_skip');
        continue;
      }

      const ent = existing.find(e => e.status === 'active') || existing[0] || null;

      // Build enriched meta consistent with grant-access-for-order
      const enrichedMeta = buildEnrichedMeta({
        rule_id: rule.id,
        order_id: ctx.orderId || null,
        source_subscription_id: sourceSubscription?.id || null,
        source_tariff_id: sourceTariffId,
        source_access_end_at: sourceSubscription?.access_end_at || null,
        source_window_rule: rule.duration_days ? 'rule_duration' : 'align_with_source',
        prior_purchase: priorInfo,
        target_product_id: targetProdId,
      });

      // INV-PHANTOM-PARENT-V1 guard REMOVED 2026-05-13.
      // Reason: business-bonus parent entitlements with hpids outside target subtree
      // are a LEGITIMATE business scenario (восстановление доступа BUSINESS-ом).
      // Resolver SOT: «Доступы» в карточке контакта = SOT видимости «Моей библиотеки».
      // hpids ограничивают список child-модулей, но НЕ скрывают parent product.
      // We keep an audit-only marker in meta for diagnostics, never block CREATE.
      const _hpidsOutsideTarget =
        enrichedMeta.scope_resolution_mode === 'module_scope_only'
        && Array.isArray(enrichedMeta.historical_module_product_ids)
        && enrichedMeta.historical_module_product_ids.length > 0
        && !enrichedMeta.historical_module_product_ids.includes(targetProdId);
      if (_hpidsOutsideTarget) {
        (enrichedMeta as any).hpids_outside_target_subtree = true;
        (enrichedMeta as any).hpids_outside_target_marker_reason =
          'business_bonus_parent_legitimate_2026_05_13';
      }

      try {
        if (!ent) {
          // CREATE
          if (!ctx.dryRun) {
            const code = productCodeMap.get(targetProdId) || (action.target_product_code ?? '') || targetProdId;
            const { error } = await supabase.from('entitlements').insert({
              user_id: userId,
              profile_id: profileId || null,
              product_id: targetProdId,
              product_code: code,
              status: 'active',
              expires_at: planned,
              meta: enrichedMeta,
            });
            if (error) {
              action.outcome = 'failed';
              action.reason = error.message;
              out.push(action);
              await writeFailedLedger(supabase, ctx, action, error.message);
              continue;
            }
          }
          action.outcome = 'granted';
          out.push(action);
          await writeGrantLedger(supabase, ctx, action, 'granted');
          continue;
        }

        // EXISTING — classify by lineage
        const meta = (ent.meta && typeof ent.meta === 'object' && !Array.isArray(ent.meta))
          ? ent.meta as Record<string, any>
          : {};
        const safeLineage = isSafeLineage(meta, rule.id);

        if (!safeLineage.isSafe) {
          action.outcome = safeLineage.reason === 'different_rule' ? 'conflict_other_rule' : 'conflict_manual';
          action.reason = safeLineage.reason;
          out.push(action);
          await writeSkipLedger(supabase, ctx, action, 'duplicate_skip');
          continue;
        }

        const currentMs = ent.expires_at ? new Date(ent.expires_at).getTime() : null;
        const plannedMs = planned ? new Date(planned).getTime() : null;

        if (ent.status === 'active' && currentMs && plannedMs && Math.abs(currentMs - plannedMs) < 60000) {
          // Safe meta-only backfill: only when priorInfo is present AND any of the
          // canonical scope keys are missing/incomplete on the existing entitlement.
          // expires_at / status / lineage flags are NEVER touched here.
          const backfillKeys = priorInfo
            ? computeMetaBackfillKeys(meta, enrichedMeta, priorInfo)
            : [];

          if (backfillKeys.length > 0) {
            const metaPatch: Record<string, any> = { ...meta };
            for (const k of backfillKeys) {
              metaPatch[k] = (enrichedMeta as Record<string, any>)[k];
            }
            metaPatch.metadata_backfilled_at = new Date().toISOString();
            metaPatch.metadata_backfill_keys = backfillKeys;

            if (!ctx.dryRun) {
              const { error: backfillErr } = await supabase
                .from('entitlements')
                .update({ meta: metaPatch, updated_at: new Date().toISOString() })
                .eq('id', ent.id);
              if (backfillErr) {
                action.outcome = 'failed';
                action.reason = `meta_backfill_failed: ${backfillErr.message}`;
                out.push(action);
                await writeFailedLedger(supabase, ctx, action, action.reason);
                continue;
              }
            }
            action.outcome = 'metadata_backfilled';
            action.reason = `keys=${backfillKeys.join(',')}`;
            out.push(action);
            await writeMetadataBackfillLedger(supabase, ctx, action, backfillKeys);
            continue;
          }

          action.outcome = 'already_satisfied';
          out.push(action);
          // No ledger row for plain "already_satisfied" — keep ledger noise low.
          continue;
        }

        if (ent.status === 'active' && plannedMs && currentMs && plannedMs < currentMs && !ctx.allowReduceAccess) {
          action.outcome = 'skipped_no_change';
          action.reason = 'planned_shorter_than_current_no_reduce';
          out.push(action);
          continue;
        }

        // Compute new expires_at via GREATEST unless allowReduceAccess
        const newExpires = (() => {
          if (!ent.expires_at) return planned;
          if (!planned) return ent.expires_at;
          if (ctx.allowReduceAccess) return planned;
          return new Date(ent.expires_at) > new Date(planned) ? ent.expires_at : planned;
        })();

        const updatePayload: Record<string, any> = {
          status: 'active',
          expires_at: newExpires,
          updated_at: new Date().toISOString(),
          meta: { ...meta, ...enrichedMeta },
        };
        // backfill profile_id if missing
        if (!ent.profile_id && profileId) updatePayload.profile_id = profileId;

        if (!ctx.dryRun) {
          const { error } = await supabase
            .from('entitlements')
            .update(updatePayload)
            .eq('id', ent.id);
          if (error) {
            action.outcome = 'failed';
            action.reason = error.message;
            out.push(action);
            await writeFailedLedger(supabase, ctx, action, error.message);
            continue;
          }
        }

        if (ent.status === 'expired') {
          action.outcome = 'reactivated';
          out.push(action);
          await writeGrantLedger(supabase, ctx, action, 'reactivated');
          continue;
        }

        action.outcome = 'extended';
        out.push(action);
        await writeGrantLedger(supabase, ctx, action, 'extended');
      } catch (err: any) {
        action.outcome = 'failed';
        action.reason = err?.message || String(err);
        out.push(action);
        await writeFailedLedger(supabase, ctx, action, action.reason || 'unknown');
      }
    }
  }

  return out;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function buildEnrichedMeta(p: {
  rule_id: string;
  order_id: string | null;
  source_subscription_id: string | null;
  source_tariff_id: string | null;
  source_access_end_at: string | null;
  source_window_rule: 'rule_duration' | 'align_with_source';
  prior_purchase: PriorPurchaseInfo | null;
  target_product_id: string;
}) {
  const base: Record<string, any> = {
    granted_by: 'rule_engine_product_access',
    source_type: 'rule_engine',
    source_rule_id: p.rule_id,
    source_order_id: p.order_id,
    business_subscription_id: p.source_subscription_id,
    business_tariff_id: p.source_tariff_id,
    source_access_end_at: p.source_access_end_at,
    source_window_rule: p.source_window_rule,
  };

  if (p.prior_purchase) {
    const pp = p.prior_purchase;
    base.prior_purchase_match_type = pp.match_type;
    base.prior_purchase_order_id = pp.order_id;
    base.historical_purchase_type = pp.historical_purchase_type;
    base.historical_tariff_id = pp.historical_tariff_id;
    base.historical_module_product_ids = pp.historical_module_product_ids;
    // Read-path SOT: useTrainingContentRules consumes scope_resolution_mode.
    // Module-only standalone history → bonus must be scoped to those modules.
    // Full tariff/product purchase → full tariff scope.
    // Anything else → safe default of no_scope (never silent full access).
    let scopeResolutionMode: string;
    if (pp.match_type === 'module_list_mapped'
        || pp.historical_purchase_type === 'module_only_standalone'
        || pp.historical_purchase_type === 'module_child_purchase') {
      scopeResolutionMode = pp.historical_module_product_ids.length > 0
        ? 'module_scope_only' : 'manual_review';
    } else if (pp.historical_tariff_id || pp.historical_purchase_type === 'base_tariff_purchase') {
      scopeResolutionMode = 'full_tariff_scope';
    } else {
      scopeResolutionMode = 'no_scope';
    }
    base.scope_resolution_mode = scopeResolutionMode;
  }

  return base;
}

/** Treat entitlement lineage as safe to update if it was originally created by rule engine
 *  or retroapply, OR has source_rule_id matching this rule, OR has no explicit lineage at all
 *  but also no manual_admin marker. */
function isSafeLineage(meta: Record<string, any>, ruleId: string): { isSafe: boolean; reason?: string } {
  const sourceType = (meta.source_type || '').toString().toLowerCase();
  const grantedBy = (meta.granted_by || '').toString().toLowerCase();
  const existingRuleId = meta.source_rule_id || null;

  // explicit manual / admin override → never auto-touch
  if (sourceType === 'manual' || sourceType === 'admin' || grantedBy.includes('admin') || grantedBy.includes('manual')) {
    return { isSafe: false, reason: 'manual_or_admin_lineage' };
  }
  // rule mismatch → conflict
  if (existingRuleId && existingRuleId !== ruleId) {
    return { isSafe: false, reason: 'different_rule' };
  }
  return { isSafe: true };
}

async function writeGrantLedger(
  supabase: SupabaseClient,
  ctx: SecondaryGrantContext,
  action: SecondaryGrantAction,
  status: 'granted' | 'extended' | 'reactivated',
) {
  if (ctx.dryRun) return;
  try {
    const eventKey = `${ctx.sourceEventKeyPrefix}:${action.rule_id}:${action.target_product_id}`;
    const actionType = status === 'extended' ? 'extend' : status === 'reactivated' ? 'reactivate' : 'grant';
    const result = await writeLedgerEntry(supabase, {
      source_event_type: ctx.sourceEventType,
      source_event_key: eventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: action.source_subscription_id || ctx.orderId || null,
      source_subscription_id: action.source_subscription_id,
      source_order_id: ctx.orderId || null,
      action_type: actionType as any,
      reason_code: 'rule_engine_bonus',
      target_type: 'product',
      target_key: `${action.user_id}:${action.target_product_id}`,
      target_ref: null,
      user_id: action.user_id,
      profile_id: action.profile_id,
      order_id: ctx.orderId || null,
      status,
      result: {
        rule_id: action.rule_id,
        target_product_id: action.target_product_id,
        previous_expires_at: action.current_expires_at,
        new_expires_at: action.planned_expires_at,
        source_window_rule: action.source_subscription_id ? 'align_with_source' : 'rule_duration',
      },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
    });
    action.ledger_id = result.id;
    action.ledger_execution_key = result.execution_key;
  } catch (e) {
    console.error('[product-access-grants] ledger write failed', e);
  }
}

async function writeSkipLedger(
  supabase: SupabaseClient,
  ctx: SecondaryGrantContext,
  action: SecondaryGrantAction,
  reasonCode: 'no_matching_target' | 'duplicate_skip',
) {
  if (ctx.dryRun) return;
  try {
    const eventKey = `${ctx.sourceEventKeyPrefix}:${action.rule_id}:${action.target_product_id}:skip`;
    await writeLedgerEntry(supabase, {
      source_event_type: ctx.sourceEventType,
      source_event_key: eventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: action.source_subscription_id || ctx.orderId || null,
      source_subscription_id: action.source_subscription_id,
      source_order_id: ctx.orderId || null,
      action_type: 'skip',
      reason_code: reasonCode,
      target_type: 'product',
      target_key: `${action.user_id}:${action.target_product_id}`,
      target_ref: null,
      user_id: action.user_id,
      profile_id: action.profile_id,
      order_id: ctx.orderId || null,
      status: 'skipped',
      result: {
        rule_id: action.rule_id,
        target_product_id: action.target_product_id,
        outcome: action.outcome,
        reason: action.reason || null,
      },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
    });
  } catch (e) {
    console.error('[product-access-grants] skip ledger failed', e);
  }
}

async function writeFailedLedger(
  supabase: SupabaseClient,
  ctx: SecondaryGrantContext,
  action: SecondaryGrantAction,
  errorMsg: string,
) {
  if (ctx.dryRun) return;
  try {
    const eventKey = `${ctx.sourceEventKeyPrefix}:${action.rule_id}:${action.target_product_id}:failed`;
    await writeLedgerEntry(supabase, {
      source_event_type: ctx.sourceEventType,
      source_event_key: eventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: action.source_subscription_id || ctx.orderId || null,
      source_subscription_id: action.source_subscription_id,
      source_order_id: ctx.orderId || null,
      action_type: 'grant',
      reason_code: 'rule_engine_bonus',
      target_type: 'product',
      target_key: `${action.user_id}:${action.target_product_id}`,
      target_ref: null,
      user_id: action.user_id,
      profile_id: action.profile_id,
      order_id: ctx.orderId || null,
      status: 'failed',
      result: { rule_id: action.rule_id, target_product_id: action.target_product_id },
      error_details: { message: errorMsg },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
    });
  } catch (e) {
    console.error('[product-access-grants] failed ledger failed', e);
  }
}

/**
 * Decide which meta keys must be backfilled on an `already_satisfied` entitlement.
 * Strict rules:
 *   - Only keys derived from priorInfo are eligible (no expires_at, no status, no lineage).
 *   - A key is selected only if it is missing, null, empty array, or differs from the
 *     value computed by buildEnrichedMeta (i.e., truly incomplete).
 *   - Returns [] when nothing needs to be patched.
 */
function computeMetaBackfillKeys(
  currentMeta: Record<string, any>,
  enrichedMeta: Record<string, any>,
  _priorInfo: PriorPurchaseInfo,
): string[] {
  const candidates = [
    'scope_resolution_mode',
    'prior_purchase_match_type',
    'prior_purchase_order_id',
    'historical_purchase_type',
    'historical_tariff_id',
    'historical_module_product_ids',
  ];
  const out: string[] = [];
  for (const key of candidates) {
    const desired = enrichedMeta[key];
    if (desired === undefined || desired === null) continue;
    if (key === 'historical_module_product_ids' && Array.isArray(desired) && desired.length === 0) continue;

    const current = currentMeta[key];
    const missing = current === undefined
      || current === null
      || (Array.isArray(current) && current.length === 0)
      || (typeof current === 'string' && current.trim() === '');

    if (missing) {
      out.push(key);
    }
  }
  return out;
}

/**
 * Ledger row for safe meta-only backfill on already_satisfied entitlements.
 * action_type='skip' / status='skipped' (no business-state change),
 * reason_code='already_active' (closest valid code), result.outcome='metadata_backfilled'.
 */
async function writeMetadataBackfillLedger(
  supabase: SupabaseClient,
  ctx: SecondaryGrantContext,
  action: SecondaryGrantAction,
  backfilledKeys: string[],
) {
  if (ctx.dryRun) return;
  try {
    const eventKey = `${ctx.sourceEventKeyPrefix}:${action.rule_id}:${action.target_product_id}:meta_backfill`;
    await writeLedgerEntry(supabase, {
      source_event_type: ctx.sourceEventType,
      source_event_key: eventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: action.source_subscription_id || ctx.orderId || null,
      source_subscription_id: action.source_subscription_id,
      source_order_id: ctx.orderId || null,
      action_type: 'skip',
      reason_code: 'already_active',
      target_type: 'product',
      target_key: `${action.user_id}:${action.target_product_id}`,
      target_ref: null,
      user_id: action.user_id,
      profile_id: action.profile_id,
      order_id: ctx.orderId || null,
      status: 'skipped',
      result: {
        rule_id: action.rule_id,
        target_product_id: action.target_product_id,
        outcome: 'metadata_backfilled',
        backfilled_keys: backfilledKeys,
      },
      metadata: {
        backfill_kind: 'secondary_product_access_meta',
        backfilled_keys: backfilledKeys,
      },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
    });
  } catch (e) {
    console.error('[product-access-grants] meta-backfill ledger failed', e);
  }
}
