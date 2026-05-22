/**
 * bepaid-receipts-2026-backfill-cron (v3)
 *
 * Scope: successful bePaid payments since 2026-01-01 with NULL receipt_url,
 * amount > 50 BYN, NOT yet attempted (meta.receipt_backfill_reason IS NULL).
 *
 * Pre-classification (no API call, terminal reason set, skip):
 *   - meta.test_payment=true OR meta has test_payment_by  → test_payment_skipped
 *   - meta has bepaid_subscription_id (sbs_*)             → subscription_phantom_uid_skipped
 *   - meta.materialization_run=bepaid_webhook_rebill_v2   → rebill_materialized_skipped
 *   - provider_payment_id IS NULL                          → no_uid_skipped
 *
 * For the rest: try bePaid GET /transactions/{uid} (gateway → api → beyag).
 *   - success + receipt_url  → fill payments_v2.receipt_url + provider_response.transaction.receipt_url
 *   - success + no receipt   → terminal reason 'bepaid_no_receipt_url'
 *   - all endpoints 4xx      → terminal reason 'bepaid_endpoint_not_found'
 *   - transport/5xx          → leave reason NULL (retry next run); abort run on 5xx streak
 *
 * Write-scope (strict): payments_v2.receipt_url, provider_response.transaction.receipt_url,
 * meta.receipt_backfill_*. NEVER touches amount/status/order_id, subscriptions_v2, entitlements,
 * access_rules.
 *
 * Guards:
 *   - batch size = 50
 *   - sleep 100ms between bePaid calls
 *   - hard cap 1000 processed rows per run (safe within edge-runtime 150s)
 *   - abort run after 5 consecutive transport/5xx failures
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getBepaidCredsStrict,
  isBepaidCredsError,
} from "../_shared/bepaid-credentials.ts";
import { fetchReceiptUrl } from "../_shared/bepaid-receipt-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;
const SLEEP_MS = 100;
const HARD_CAP_PER_RUN = 1000;
const MAX_CONSECUTIVE_5XX = 5;
const BATCH_ID = "bepaid_receipts_2026_backfill";
const SCOPE_FROM = "2026-01-01T00:00:00Z";
const SCOPE_ORIGINS = ["bepaid", "bepaid_subscription"];
const SCOPE_STATUSES = ["succeeded"];
const MIN_AMOUNT_BYN = 50;

type Reason =
  | "bepaid_no_receipt_url"
  | "bepaid_endpoint_not_found"
  | "test_payment_skipped"
  | "subscription_phantom_uid_skipped"
  | "rebill_materialized_skipped"
  | "no_uid_skipped";

function preClassify(meta: Record<string, any> | null, providerPaymentId: string | null): Reason | null {
  const m = meta || {};
  if (!providerPaymentId) return "no_uid_skipped";
  if (m.test_payment === true || m.test_payment === "true" || m.test_payment_by) return "test_payment_skipped";
  if (m.materialization_run === "bepaid_webhook_rebill_v2") return "rebill_materialized_skipped";
  if (m.bepaid_subscription_id) return "subscription_phantom_uid_skipped";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const credsResult = await getBepaidCredsStrict(supabase);
  if (isBepaidCredsError(credsResult)) {
    return new Response(
      JSON.stringify({ success: false, error: credsResult.error }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const startedAt = Date.now();
  const metrics = {
    batches: 0,
    processed: 0,
    filled: 0,
    skipped_already_has: 0,
    pre_classified: {
      test_payment_skipped: 0,
      subscription_phantom_uid_skipped: 0,
      rebill_materialized_skipped: 0,
      no_uid_skipped: 0,
    } as Record<string, number>,
    bepaid_endpoint_not_found: 0,
    bepaid_no_receipt_url: 0,
    transport_failed: 0,
    aborted_reason: null as string | null,
    sample_filled_ids: [] as string[],
  };

  let consecutive5xx = 0;

  outer: while (metrics.processed < HARD_CAP_PER_RUN) {
    const remaining = HARD_CAP_PER_RUN - metrics.processed;
    const limit = Math.min(BATCH_SIZE, remaining);

    // CRITICAL: exclude rows that already have a terminal reason — otherwise
    // the same 25 failing rows are picked up on every cron tick.
    const { data: payments, error: fetchErr } = await supabase
      .from("payments_v2")
      .select("id, provider_payment_id, receipt_url, provider_response, meta")
      .in("origin", SCOPE_ORIGINS)
      .in("status", SCOPE_STATUSES)
      .is("receipt_url", null)
      .gt("amount", MIN_AMOUNT_BYN)
      .gte("created_at", SCOPE_FROM)
      .is("meta->>receipt_backfill_reason", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (fetchErr) {
      metrics.aborted_reason = `fetch_error:${fetchErr.message}`;
      break;
    }
    if (!payments || payments.length === 0) break;

    metrics.batches++;

    for (const p of payments) {
      metrics.processed++;
      if (p.receipt_url) { metrics.skipped_already_has++; continue; }

      const freshMeta = (p.meta as Record<string, any>) || {};
      const preReason = preClassify(freshMeta, p.provider_payment_id as string | null);

      if (preReason) {
        await supabase.from("payments_v2").update({
          meta: {
            ...freshMeta,
            receipt_backfill_reason: preReason,
            receipt_backfill_batch: BATCH_ID,
            receipt_backfill_at: new Date().toISOString(),
          },
        }).eq("id", p.id);
        metrics.pre_classified[preReason] = (metrics.pre_classified[preReason] || 0) + 1;
        continue;
      }

      let result;
      let threw = false;
      try {
        result = await fetchReceiptUrl(p.provider_payment_id as string, credsResult);
      } catch (err) {
        result = { ok: false, error: String(err) };
        threw = true;
      }

      if (threw) {
        consecutive5xx++;
        metrics.transport_failed++;
        if (consecutive5xx >= MAX_CONSECUTIVE_5XX) {
          metrics.aborted_reason = "bepaid_5xx_streak";
          break outer;
        }
        await sleep(SLEEP_MS);
        continue;
      }
      consecutive5xx = 0;

      if (!result.ok || !result.receipt_url) {
        const reason: Reason = result.ok ? "bepaid_no_receipt_url" : "bepaid_endpoint_not_found";
        await supabase.from("payments_v2").update({
          meta: {
            ...freshMeta,
            receipt_backfill_reason: reason,
            receipt_backfill_batch: BATCH_ID,
            receipt_backfill_at: new Date().toISOString(),
          },
        }).eq("id", p.id);
        if (reason === "bepaid_endpoint_not_found") metrics.bepaid_endpoint_not_found++;
        else metrics.bepaid_no_receipt_url++;
        await sleep(SLEEP_MS);
        continue;
      }

      const freshResp = (p.provider_response as Record<string, any>) || {};
      const mergedResp = {
        ...freshResp,
        transaction: { ...(freshResp.transaction || {}), receipt_url: result.receipt_url },
      };

      const { error: updateErr } = await supabase
        .from("payments_v2")
        .update({
          receipt_url: result.receipt_url,
          provider_response: mergedResp,
          meta: {
            ...freshMeta,
            receipt_backfill_source: "bepaid_api_2026_cron",
            receipt_backfill_batch: BATCH_ID,
            receipt_backfill_at: new Date().toISOString(),
            receipt_backfill_endpoint: result.endpoint_used ?? null,
          },
        })
        .eq("id", p.id)
        .is("receipt_url", null);

      if (updateErr) {
        metrics.transport_failed++;
      } else {
        metrics.filled++;
        if (metrics.sample_filled_ids.length < 25) metrics.sample_filled_ids.push(p.id);
      }

      await sleep(SLEEP_MS);
    }

    if (payments.length < limit) break;
  }

  const durationMs = Date.now() - startedAt;

  await supabase.from("audit_logs").insert({
    action: "payments.receipt_url_backfilled",
    actor_type: "system",
    actor_user_id: null,
    actor_label: BATCH_ID,
    meta: {
      batch_id: BATCH_ID,
      scope: { from: SCOPE_FROM, origins: SCOPE_ORIGINS, statuses: SCOPE_STATUSES, min_amount: MIN_AMOUNT_BYN },
      ...metrics,
      duration_ms: durationMs,
    },
  });

  return new Response(
    JSON.stringify({ success: true, batch_id: BATCH_ID, duration_ms: durationMs, ...metrics }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
