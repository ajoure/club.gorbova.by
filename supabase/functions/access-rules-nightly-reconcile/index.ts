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

interface OutcomeBuckets {
  granted: number;
  extended: number;
  reactivated: number;
  already_satisfied: number;
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

    // 1. Pull active subscriptions cohort.
    let subQ = supabase
      .from('subscriptions_v2')
      .select('id, user_id, profile_id, product_id, tariff_id, access_end_at, status')
      .eq('status', 'active')
      .limit(maxSubs);

    if (body.tariff_ids?.length) subQ = subQ.in('tariff_id', body.tariff_ids);
    if (body.product_ids?.length) subQ = subQ.in('product_id', body.product_ids);
    if (body.user_ids?.length) subQ = subQ.in('user_id', body.user_ids);

    const { data: subs, error: subErr } = await subQ;
    if (subErr) throw subErr;
    const subscriptions = subs || [];

    // 2. For each unique (product_id, tariff_id) — resolve rules once, cache.
    const ruleCacheKey = (pid: string, tid: string | null) => `${pid}::${tid || 'null'}`;
    const rulesByKey = new Map<string, Awaited<ReturnType<typeof resolveProductAccessRules>>>();
    for (const s of subscriptions) {
      const key = ruleCacheKey(s.product_id, s.tariff_id);
      if (rulesByKey.has(key)) continue;
      const rules = await resolveProductAccessRules(supabase, s.product_id, s.tariff_id);
      rulesByKey.set(key, rules);
    }

    // 3. Build batch prior_purchase cache for the WHOLE cohort.
    //    SOT: orders_v2.status='paid' only.
    const allUserIds = [...new Set(subscriptions.map((s) => s.user_id).filter(Boolean) as string[])];
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
    let processed = 0;

    for (const s of subscriptions) {
      const rules = rulesByKey.get(ruleCacheKey(s.product_id, s.tariff_id)) || [];
      if (rules.length === 0) continue;

      const actions = await syncSecondaryProductAccessForUser(supabase, {
        userId: s.user_id,
        profileId: s.profile_id,
        sourceProductId: s.product_id,
        sourceTariffId: s.tariff_id,
        sourceSubscription: { id: s.id, access_end_at: s.access_end_at },
        rules,
        priorPurchaseCache,
        ctx: {
          sourceEventType: 'cron',
          sourceSubjectType: 'cron_job',
          sourceEventKeyPrefix: `nightly_reconcile:${new Date().toISOString().slice(0, 10)}:${s.id}`,
          orderId: null,
          dryRun,
        },
      });

      for (const a of actions) bumpBucket(buckets, a);
      if (sampleActions.length < 50) {
        for (const a of actions) {
          if (sampleActions.length >= 50) break;
          if (a.outcome !== 'already_satisfied' && a.outcome !== 'condition_not_met') {
            sampleActions.push(a);
          }
        }
      }
      processed++;
    }

    const elapsedMs = Date.now() - startedAt;
    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        subscriptions_total: subscriptions.length,
        subscriptions_processed: processed,
        rule_pairs_evaluated:
          (Object.values(buckets) as number[]).reduce((a, b) => a + b, 0),
        buckets,
        sample_actions: sampleActions,
        elapsed_ms: elapsedMs,
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
