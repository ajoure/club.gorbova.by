/**
 * bepaid-receipts-2026-backfill-cron
 *
 * Scope: successful bePaid payments since 2026-01-01 with NULL receipt_url
 * and present provider_payment_id. Pulls receipt_url from bePaid API and
 * writes ONLY receipt_url + provider_response.transaction.receipt_url +
 * meta.receipt_backfill_* markers. Never touches amount/status/order_id/
 * subscriptions/access. Runs on a cron schedule (every 5 minutes).
 *
 * Guards:
 *   - batch size = 25
 *   - sleep 200ms between bePaid calls
 *   - hard cap 500 successful updates per run
 *   - abort run after 5 consecutive 5xx responses from bePaid
 *   - fill-only: never overwrites existing receipt_url
 *   - failed/canceled/refunded payments are out of scope by the SELECT filter
 *
 * Audit:
 *   action      = 'payments.receipt_url_backfilled'
 *   actor_type  = 'system'
 *   batch_id    = 'bepaid_receipts_2026_backfill'
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

const BATCH_SIZE = 25;
const SLEEP_MS = 200;
const HARD_CAP_PER_RUN = 500;
const MAX_CONSECUTIVE_5XX = 5;
const BATCH_ID = "bepaid_receipts_2026_backfill";
const SCOPE_FROM = "2026-01-01T00:00:00Z";
const SCOPE_ORIGINS = ["bepaid", "bepaid_subscription"];
const SCOPE_STATUSES = ["succeeded"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    no_receipt_returned: 0,
    failed: 0,
    aborted_reason: null as string | null,
    sample_filled_ids: [] as string[],
  };

  let consecutive5xx = 0;

  outer: while (metrics.filled < HARD_CAP_PER_RUN) {
    const remaining = HARD_CAP_PER_RUN - metrics.filled;
    const limit = Math.min(BATCH_SIZE, remaining);

    const { data: payments, error: fetchErr } = await supabase
      .from("payments_v2")
      .select("id, provider_payment_id, receipt_url, provider_response, meta")
      .in("origin", SCOPE_ORIGINS)
      .in("status", SCOPE_STATUSES)
      .is("receipt_url", null)
      .not("provider_payment_id", "is", null)
      .gte("created_at", SCOPE_FROM)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (fetchErr) {
      metrics.aborted_reason = `fetch_error:${fetchErr.message}`;
      break;
    }
    if (!payments || payments.length === 0) break;

    metrics.batches++;

    for (const p of payments) {
      metrics.processed++;

      // Fill-only safety: re-check
      if (p.receipt_url) {
        metrics.skipped_already_has++;
        continue;
      }

      let result;
      try {
        result = await fetchReceiptUrl(p.provider_payment_id as string, credsResult);
      } catch (err) {
        result = { ok: false, error: String(err) };
      }

      // Detect 5xx-ish failures (fetcher returns ok:false with All endpoints failed)
      if (!result.ok) {
        consecutive5xx++;
        metrics.failed++;
        if (consecutive5xx >= MAX_CONSECUTIVE_5XX) {
          metrics.aborted_reason = "bepaid_5xx_streak";
          break outer;
        }
        await sleep(SLEEP_MS);
        continue;
      }
      consecutive5xx = 0;

      if (!result.receipt_url) {
        const freshMeta = (p.meta as Record<string, any>) || {};
        await supabase
          .from("payments_v2")
          .update({
            meta: {
              ...freshMeta,
              receipt_backfill_reason: "bepaid_no_receipt_url",
              receipt_backfill_batch: BATCH_ID,
              receipt_backfill_at: new Date().toISOString(),
            },
          })
          .eq("id", p.id);
        metrics.no_receipt_returned++;
        await sleep(SLEEP_MS);
        continue;
      }

      const freshMeta = (p.meta as Record<string, any>) || {};
      const freshResp = (p.provider_response as Record<string, any>) || {};
      const mergedResp = {
        ...freshResp,
        transaction: {
          ...(freshResp.transaction || {}),
          receipt_url: result.receipt_url,
        },
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
        .is("receipt_url", null); // race-guard

      if (updateErr) {
        metrics.failed++;
      } else {
        metrics.filled++;
        if (metrics.sample_filled_ids.length < 25) {
          metrics.sample_filled_ids.push(p.id);
        }
      }

      await sleep(SLEEP_MS);
    }

    // If the batch was smaller than the limit — there are no more matching rows.
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
      scope: { from: SCOPE_FROM, origins: SCOPE_ORIGINS, statuses: SCOPE_STATUSES },
      ...metrics,
      duration_ms: durationMs,
    },
  });

  return new Response(
    JSON.stringify({ success: true, batch_id: BATCH_ID, duration_ms: durationMs, ...metrics }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
