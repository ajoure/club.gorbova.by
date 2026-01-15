import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * PATCH 2: Combined Cron for bePaid sync
 * 
 * Runs both:
 * 1. bepaid-fetch-transactions (pull new transactions from API)
 * 2. bepaid-queue-cron (process pending queue items)
 * 
 * Designed to run every 10-15 minutes via external cron
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const startTime = Date.now();

  console.log("[bepaid-sync-cron] Starting combined sync...");

  const results = {
    fetch: null as any,
    queue: null as any,
    duration_ms: 0,
    success: true,
    errors: [] as string[],
  };

  try {
    // Step 1: Fetch new transactions from bePaid API
    console.log("[bepaid-sync-cron] Step 1: Fetching transactions...");
    
    const { data: fetchResult, error: fetchError } = await supabase.functions.invoke(
      "bepaid-fetch-transactions",
      { body: {} }
    );

    if (fetchError) {
      console.error("[bepaid-sync-cron] Fetch error:", fetchError);
      results.errors.push(`Fetch: ${fetchError.message}`);
      results.success = false;
    } else {
      results.fetch = fetchResult;
      console.log("[bepaid-sync-cron] Fetch result:", {
        transactions: fetchResult?.transactions_fetched,
        queued: fetchResult?.queued_for_review,
        matched: fetchResult?.payments_matched,
      });
    }

    // Step 2: Process queue items
    console.log("[bepaid-sync-cron] Step 2: Processing queue...");
    
    const { data: queueResult, error: queueError } = await supabase.functions.invoke(
      "bepaid-queue-cron",
      { body: { batchSize: 30, maxAttempts: 5 } }
    );

    if (queueError) {
      console.error("[bepaid-sync-cron] Queue error:", queueError);
      results.errors.push(`Queue: ${queueError.message}`);
      results.success = false;
    } else {
      results.queue = queueResult;
      console.log("[bepaid-sync-cron] Queue result:", {
        processed: queueResult?.processed,
        success: queueResult?.orders_created,
        failed: queueResult?.failed,
      });
    }

    results.duration_ms = Date.now() - startTime;

    // Log to audit_logs
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: "system",
      actor_label: "bepaid-sync-cron",
      action: "bepaid_sync_cron_run",
      meta: {
        fetch: {
          transactions_fetched: results.fetch?.transactions_fetched || 0,
          pages_fetched: results.fetch?.pages_fetched || 0,
          queued_for_review: results.fetch?.queued_for_review || 0,
          payments_matched: results.fetch?.payments_matched || 0,
          already_exists: results.fetch?.already_exists || 0,
          errors: results.fetch?.errors || 0,
        },
        queue: {
          processed: results.queue?.processed || 0,
          orders_created: results.queue?.orders_created || 0,
          failed: results.queue?.failed || 0,
          skipped: results.queue?.skipped || 0,
        },
        duration_ms: results.duration_ms,
        errors: results.errors,
      },
    });

    console.log(`[bepaid-sync-cron] Completed in ${results.duration_ms}ms`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[bepaid-sync-cron] Fatal error:", error);
    
    results.duration_ms = Date.now() - startTime;
    results.success = false;
    results.errors.push(String(error));

    return new Response(
      JSON.stringify(results),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
