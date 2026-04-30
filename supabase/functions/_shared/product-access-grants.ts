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
     * Key = userId, Value = Set of product_ids the user has paid for (orders_v2.status='paid').
     * If not provided, helper falls back to per-product checkPriorPurchase (single webhook flow).
     */
    priorPurchaseCache?: Map<string, Set<string>>;
    ctx: SecondaryGrantContext;
  },
): Promise<SecondaryGrantAction[]> {
  const { userId, profileId, sourceProductId, sourceTariffId, sourceSubscription, rules, ctx, priorPurchaseCache } = params;
  const excludeOrderId = params.excludeOrderId || '00000000-0000-0000-0000-000000000000';
  const userPaidSet = priorPurchaseCache?.get(userId) ?? null;

  const hasPriorFromCache = (productId: string): boolean => {
    return userPaidSet ? userPaidSet.has(productId) : false;
  };

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
      if (hasPriorPurchase) {
        const matchMode = conditions.match_mode || 'any';
        const reqList: string[] = Array.isArray(conditions.required_product_ids)
          ? conditions.required_product_ids
          : conditions.required_product_id ? [conditions.required_product_id] : [];

        let conditionMet = false;
        if (matchMode === 'per_product') {
          // For per_product, the prior purchase must match this specific target product
          // Match canonical behavior of grant-access-for-order: only check when the target is in the list
          if (reqList.length === 0 || reqList.includes(targetProdId)) {
            const r = await checkPriorPurchase(supabase, userId, targetProdId, excludeOrderId);
            conditionMet = r.found;
          }
        } else {
          // any/all
          for (const reqId of reqList) {
            const r = await checkPriorPurchase(supabase, userId, reqId, excludeOrderId);
            if (matchMode === 'any' && r.found) { conditionMet = true; break; }
            if (matchMode === 'all' && !r.found) { conditionMet = false; break; }
            if (matchMode === 'all') conditionMet = true;
          }
          if (reqList.length === 0) conditionMet = true; // no condition → pass
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
      });

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
          action.outcome = 'already_satisfied';
          out.push(action);
          // No ledger row for "already_satisfied" — keep ledger noise low.
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
}) {
  return {
    granted_by: 'rule_engine_product_access',
    source_type: 'rule_engine',
    source_rule_id: p.rule_id,
    source_order_id: p.order_id,
    business_subscription_id: p.source_subscription_id,
    business_tariff_id: p.source_tariff_id,
    source_access_end_at: p.source_access_end_at,
    source_window_rule: p.source_window_rule,
  };
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
