/**
 * Nightly reconcile of secondary product_access entitlements.
 *
 * Runs at 03:00 Minsk (00:00 UTC). For every active subscriber of every product
 * that has product_access rules attached, ensures secondary entitlements (bonus access)
 * are present and aligned with the source subscription window.
 *
 * Uses the SAME shared helper as grant-access-for-order:
 *   _shared/product-access-grants.ts → syncSecondaryProductAccessForUser
 *
 * Modes:
 *   - dry_run: true  → no DB mutations, returns counts and per-action breakdown
 *   - dry_run: false → executes grants/extensions/reactivations
 *
 * Optional filters:
 *   - tariff_ids: limit cohort to specific tariffs (e.g., BUSINESS only)
 *   - product_ids: limit to specific source products
 *   - user_ids: limit to specific users (debug)
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  resolveProductAccessRules,
  syncSecondaryProductAccessForUser,
  buildPriorPurchaseCache,
  collectPriorPurchaseProductIds,
  type SecondaryGrantAction,
} from '../_shared/product-access-grants.ts';

interface ReconcilePayload {
  dry_run?: boolean;
  tariff_ids?: string[];
  product_ids?: string[];
  user_ids?: string[];
  /** Hard cap on processed subscriptions for safety. */
  max_subscriptions?: number;
}

type ReconcileSource = {
  id: string;
  user_id: string;
  profile_id: string | null;
  product_id: string;
  tariff_id: string | null;
  access_end_at: string | null;
  source_kind: 'subscription' | 'entitlement_source';
};

// Only canonical Club bonus sources may drive downstream product_access rules.
// The second origin is the controlled CB20 backfill created before the shared
// upsert helper started stamping the current canonical origin.
const CLUB_BONUS_SOURCE_ORIGINS = [
  'upsert_club_bonus_entitlement_source',
  'controlled_cb20_bonus_backfill_20260810',
] as const;

interface OutcomeBuckets {
  granted: number;
  extended: number;
  reactivated: number;
  already_satisfied: number;
  metadata_backfilled: number;
  condition_not_met_prior_purchase: number;
  no_source_window: number;
  conflict_manual: number;
  conflict_other_rule: number;
  conflict_multiple: number;
  skipped_no_change: number;
  skipped_disabled: number;
  failed: number;
}

const emptyBuckets = (): OutcomeBuckets => ({
  granted: 0,
  extended: 0,
  reactivated: 0,
  already_satisfied: 0,
  metadata_backfilled: 0,
  condition_not_met_prior_purchase: 0,
  no_source_window: 0,
  conflict_manual: 0,
  conflict_other_rule: 0,
  conflict_multiple: 0,
  skipped_no_change: 0,
  skipped_disabled: 0,
  failed: 0,
});

function bumpBucket(b: OutcomeBuckets, a: SecondaryGrantAction) {
  switch (a.outcome) {
    case 'condition_not_met':
      b.condition_not_met_prior_purchase++;
      break;
    case 'granted':
    case 'extended':
    case 'reactivated':
    case 'already_satisfied':
    case 'metadata_backfilled':
    case 'no_source_window':
    case 'conflict_manual':
    case 'conflict_other_rule':
    case 'conflict_multiple':
    case 'skipped_no_change':
    case 'skipped_disabled':
    case 'failed':
      b[a.outcome]++;
      break;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body: ReconcilePayload = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run !== false; // default true for safety
    const maxSubs = body.max_subscriptions ?? 5000;

    // 1. Pull paid recurring sources plus independently expiring bonus sources.
    // A Club bonus created by a course purchase intentionally has no row in
    // subscriptions_v2. Excluding entitlement_sources here left its downstream
    // prior_purchase product grants unrepaired by the nightly job.
    let subQ = supabase
      .from('subscriptions_v2')
      .select('id, user_id, profile_id, product_id, tariff_id, access_end_at, status')
      .in('status', ['active', 'past_due'])
      .limit(maxSubs);

    if (body.tariff_ids?.length) subQ = subQ.in('tariff_id', body.tariff_ids);
    if (body.product_ids?.length) subQ = subQ.in('product_id', body.product_ids);
    if (body.user_ids?.length) subQ = subQ.in('user_id', body.user_ids);

    const { data: subs, error: subErr } = await subQ;
    if (subErr) throw subErr;
    const nowIso = new Date().toISOString();
    const subscriptions = (subs || []).filter((s) =>
      s.status === 'active'
      || (s.status === 'past_due' && !!s.access_end_at && s.access_end_at > nowIso)
    );

    const remainingSourceCapacity = Math.max(0, maxSubs - subscriptions.length);
    let bonusSources: Array<{
      id: string;
      user_id: string;
      profile_id: string | null;
      product_id: string;
      tariff_id: string | null;
      expires_at: string | null;
    }> = [];
    if (remainingSourceCapacity > 0) {
      let bonusQ = supabase
        .from('entitlement_sources')
        .select('id, user_id, profile_id, product_id, tariff_id, expires_at')
        .eq('source_type', 'bonus')
        .in('meta->>origin', [...CLUB_BONUS_SOURCE_ORIGINS])
        .eq('status', 'active')
        .gt('expires_at', nowIso)
        .limit(remainingSourceCapacity);
      if (body.tariff_ids?.length) bonusQ = bonusQ.in('tariff_id', body.tariff_ids);
      if (body.product_ids?.length) bonusQ = bonusQ.in('product_id', body.product_ids);
      if (body.user_ids?.length) bonusQ = bonusQ.in('user_id', body.user_ids);

      const { data: bonusRows, error: bonusErr } = await bonusQ;
      if (bonusErr) throw bonusErr;
      bonusSources = (bonusRows || []) as typeof bonusSources;
    }

    const sources: ReconcileSource[] = [
      ...subscriptions.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        profile_id: s.profile_id,
        product_id: s.product_id,
        tariff_id: s.tariff_id,
        access_end_at: s.access_end_at,
        source_kind: 'subscription' as const,
      })),
      ...bonusSources.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        profile_id: s.profile_id,
        product_id: s.product_id,
        tariff_id: s.tariff_id,
        access_end_at: s.expires_at,
        source_kind: 'entitlement_source' as const,
      })),
    ];

    // 2. For each unique (product_id, tariff_id) — resolve rules once, cache.
    const ruleCacheKey = (pid: string, tid: string | null) => `${pid}::${tid || 'null'}`;
    const rulesByKey = new Map<string, Awaited<ReturnType<typeof resolveProductAccessRules>>>();
    for (const s of sources) {
      const key = ruleCacheKey(s.product_id, s.tariff_id);
      if (rulesByKey.has(key)) continue;
      const rules = await resolveProductAccessRules(supabase, s.product_id, s.tariff_id);
      rulesByKey.set(key, rules);
    }

    // 3. Build batch prior_purchase cache for the WHOLE cohort.
    //    SOT: orders_v2.status='paid' only.
    const allUserIds = [...new Set(sources.map((s) => s.user_id).filter(Boolean) as string[])];
    const allRules = [...rulesByKey.values()].flat();
    const allRequiredProductIds = collectPriorPurchaseProductIds(allRules);
    const priorPurchaseCache = await buildPriorPurchaseCache(
      supabase,
      allUserIds,
      allRequiredProductIds,
    );

    // 4. Iterate subscriptions, run helper.
    const buckets = emptyBuckets();
    const sampleActions: SecondaryGrantAction[] = [];
    const sampleConditionNotMet: SecondaryGrantAction[] = [];
    let processed = 0;
    let moduleListMappedMatches = 0;

    // Tally module_list_mapped matches across the cache for observability.
    for (const userMap of priorPurchaseCache.values()) {
      for (const info of userMap.values()) {
        if (info.match_type === 'module_list_mapped') moduleListMappedMatches++;
      }
    }

    let processedSubscriptions = 0;
    let processedEntitlementSources = 0;
    for (const s of sources) {
      const rules = rulesByKey.get(ruleCacheKey(s.product_id, s.tariff_id)) || [];
      if (rules.length === 0) continue;

      const actions = await syncSecondaryProductAccessForUser(supabase, {
        userId: s.user_id,
        profileId: s.profile_id,
        sourceProductId: s.product_id,
        sourceTariffId: s.tariff_id,
        sourceSubscription: s.source_kind === 'subscription'
          ? { id: s.id, access_end_at: s.access_end_at }
          : null,
        sourceEntitlementSource: s.source_kind === 'entitlement_source'
          ? { id: s.id, access_end_at: s.access_end_at }
          : null,
        rules,
        priorPurchaseCache,
        ctx: {
          sourceEventType: 'cron',
          sourceSubjectType: 'cron_job',
          sourceEventKeyPrefix: `nightly_reconcile:${new Date().toISOString().slice(0, 10)}:${s.source_kind}:${s.id}`,
          orderId: null,
          dryRun,
        },
      });

      for (const a of actions) bumpBucket(buckets, a);
      for (const a of actions) {
        if (sampleActions.length < 50
            && a.outcome !== 'already_satisfied'
            && a.outcome !== 'condition_not_met') {
          sampleActions.push(a);
        }
        if (sampleConditionNotMet.length < 50 && a.outcome === 'condition_not_met') {
          sampleConditionNotMet.push(a);
        }
      }
      processed++;
      if (s.source_kind === 'subscription') processedSubscriptions++;
      else processedEntitlementSources++;
    }

    const elapsedMs = Date.now() - startedAt;
    const runId = `${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}`;
    const totalEvaluated = (Object.values(buckets) as number[]).reduce((a, b) => a + b, 0);
    const conditionMet =
      buckets.granted +
      buckets.extended +
      buckets.reactivated +
      buckets.already_satisfied +
      buckets.metadata_backfilled +
      buckets.skipped_no_change +
      buckets.no_source_window +
      buckets.conflict_manual +
      buckets.conflict_other_rule +
      buckets.conflict_multiple +
      buckets.failed;

    // ── Stage 4: extra-access classifier alignment (preview-only) ──
    // Calls rules-retroapply in nightly_safe + preview mode for the same cohort,
    // collects extra-access category counts, and writes them into the audit summary.
    // No mutations performed by this call. Nightly NEVER executes destructive actions.
    let extraAccessCounts: Record<string, number> = {};
    let extraAccessError: string | null = null;
    try {
      const distinctProductIds = [...new Set(sources.map((s) => s.product_id).filter(Boolean))];
      const distinctTariffIds = [...new Set(sources.map((s) => s.tariff_id).filter(Boolean))];

      const previewBody: Record<string, unknown> = {
        mode: 'preview',
        reconcile_mode: 'nightly_safe',
      };
      // Prefer narrowest scope: explicit filters > product-wide.
      if (body.tariff_ids?.length && distinctTariffIds.length === 1) {
        previewBody.source_tariff_id = distinctTariffIds[0];
      } else if (body.product_ids?.length && distinctProductIds.length === 1) {
        previewBody.source_product_id = distinctProductIds[0];
      } else if (distinctTariffIds.length === 1) {
        previewBody.source_tariff_id = distinctTariffIds[0];
      } else if (distinctProductIds.length === 1) {
        previewBody.source_product_id = distinctProductIds[0];
      } else {
        // Multi-product cohort: rely on changed_since=now-30d as broad scope marker.
        previewBody.changed_since = new Date(Date.now() - 30 * 86400000).toISOString();
      }
      if (body.user_ids?.length) previewBody.user_ids = body.user_ids;

      const previewResp = await fetch(`${SUPABASE_URL}/functions/v1/rules-retroapply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
        },
        body: JSON.stringify(previewBody),
      });
      if (previewResp.ok) {
        const previewData = await previewResp.json();
        const s = previewData?.summary || {};
        extraAccessCounts = {
          soft_expire_extra_access: s.soft_expire_extra_access || 0,
          revoke_extra_access: s.revoke_extra_access || 0,
          manual_review_ambiguous_source: s.manual_review_ambiguous_source || 0,
          manual_review_paid_access_exists: s.manual_review_paid_access_exists || 0,
          relink_source_rule: s.relink_source_rule || 0,
          replace_system_or_manual_lineage: s.replace_system_or_manual_lineage || 0,
          telegram_action_required: s.telegram_action_required || 0,
        };
      } else {
        extraAccessError = `preview_http_${previewResp.status}`;
      }
    } catch (e) {
      extraAccessError = e instanceof Error ? e.message : String(e);
    }

    // Mandatory audit summary — observable for every run, dry_run or execute.
    try {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: 'access-rules-nightly-reconcile',
        action: dryRun
          ? 'access-rules-nightly-reconcile.dry_run'
          : 'access-rules-nightly-reconcile.execute',
        meta: {
          run_id: runId,
          dry_run: dryRun,
          source: (body as any).source || null,
          filter_tariff_ids: body.tariff_ids || null,
          filter_product_ids: body.product_ids || null,
          filter_user_ids: body.user_ids || null,
          max_subscriptions: maxSubs,
          cohort_size: sources.length,
          subscription_sources: subscriptions.length,
          entitlement_sources: bonusSources.length,
          processed_sources: processed,
          processed_subscriptions: processedSubscriptions,
          processed_subscription_sources: processedSubscriptions,
          processed_entitlement_sources: processedEntitlementSources,
          rule_pairs_evaluated: totalEvaluated,
          condition_met: conditionMet,
          condition_not_met_prior_purchase: buckets.condition_not_met_prior_purchase,
          granted: buckets.granted,
          extended: buckets.extended,
          reactivated: buckets.reactivated,
          already_satisfied: buckets.already_satisfied,
          metadata_backfilled: buckets.metadata_backfilled,
          skipped_no_change: buckets.skipped_no_change,
          no_source_window: buckets.no_source_window,
          conflict_manual: buckets.conflict_manual,
          conflict_other_rule: buckets.conflict_other_rule,
          conflict_multiple: buckets.conflict_multiple,
          failed: buckets.failed,
          module_list_mapped_matches: moduleListMappedMatches,
          elapsed_ms: elapsedMs,
          // Stage 4: extra-access preview counts (no execution — preview-only)
          stage4_extra_access_counts: extraAccessCounts,
          stage4_extra_access_error: extraAccessError,
          stage4_destructive_executed: false,
        },
      });
    } catch (auditErr) {
      console.error('[access-rules-nightly-reconcile] audit summary write failed:', auditErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        dry_run: dryRun,
        sources_total: sources.length,
        subscription_sources_total: subscriptions.length,
        entitlement_sources_total: bonusSources.length,
        subscriptions_total: subscriptions.length,
        subscriptions_processed: processedSubscriptions,
        entitlement_sources_processed: processedEntitlementSources,
        rule_pairs_evaluated: totalEvaluated,
        counts: {
          condition_met: conditionMet,
          condition_not_met_prior_purchase: buckets.condition_not_met_prior_purchase,
          missing_granted: buckets.granted,
          needs_extension_extended: buckets.extended,
          reactivation_candidates_reactivated: buckets.reactivated,
          conflicts:
            buckets.conflict_manual + buckets.conflict_other_rule + buckets.conflict_multiple,
          failed: buckets.failed,
        },
        buckets,
        sample_actions: sampleActions,
        sample_condition_not_met: sampleConditionNotMet,
        module_list_mapped_matches: moduleListMappedMatches,
        elapsed_ms: elapsedMs,
        stage4_extra_access_counts: extraAccessCounts,
        stage4_extra_access_error: extraAccessError,
        stage4_destructive_executed: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
