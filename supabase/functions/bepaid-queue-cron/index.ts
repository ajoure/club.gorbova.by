import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * PATCH 3: Queue processing with proper retry logic
 * 
 * - Respects next_retry_at for backoff
 * - Updates attempts counter
 * - Skips items with max attempts reached
 * - Logs results to audit_logs
 */

// Calculate backoff delay for retry
function calculateBackoffDelay(attempts: number): number {
  // Exponential backoff: 5min, 15min, 45min, 2h, 6h
  const delays = [5, 15, 45, 120, 360];
  const idx = Math.min(attempts, delays.length - 1);
  return delays[idx] * 60 * 1000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const maxAttempts = body.maxAttempts || 5;
    const batchSize = body.batchSize || 20;
    const excludeFileImport = body.excludeFileImport !== false; // Default: exclude file_import

    console.log(`[bepaid-queue-cron] Starting queue processing, batch size: ${batchSize}, max attempts: ${maxAttempts}, excludeFileImport: ${excludeFileImport}`);

    const now = new Date().toISOString();

    // PATCH 3: Get pending items with proper retry logic
    // Only get items where:
    // - status is pending or error
    // - attempts < maxAttempts
    // - next_retry_at is null OR <= now (ready for retry)
    // PATCH: Prioritize webhook source, exclude file_import by default
    let query = supabase
      .from("payment_reconcile_queue")
      .select("id, bepaid_uid, customer_email, amount, currency, attempts, status, next_retry_at, last_error, source")
      .in("status", ["pending", "error"])
      .lt("attempts", maxAttempts)
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`);
    
    // Exclude file_import by default - these need manual cleanup
    if (excludeFileImport) {
      query = query.neq("source", "file_import");
    }
    
    // Order by source (webhook first) then by created_at
    const { data: pendingItems, error: fetchError } = await query
      .order("source", { ascending: false }) // 'webhook' > 'csv' > 'file_import' alphabetically reversed
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (fetchError) {
      throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    }

    if (!pendingItems || pendingItems.length === 0) {
      console.log("[bepaid-queue-cron] No pending items ready for processing");
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No pending items ready" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bepaid-queue-cron] Found ${pendingItems.length} items to process`);

    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      webhook_processed: 0,
      errors: [] as string[],
    };

    for (const item of pendingItems) {
      try {
        console.log(`[bepaid-queue-cron] Processing item ${item.id}, source=${item.source}, bepaid_uid=${item.bepaid_uid}, attempts=${item.attempts}`);
        
        // Update item to processing status
        await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "processing",
            last_attempt_at: now,
          })
          .eq("id", item.id);

        const { data: processResult, error: processError } = await supabase.functions.invoke(
          "bepaid-auto-process",
          {
            body: { queueItemId: item.id },
          }
        );

        if (processError) {
          console.error(`[bepaid-queue-cron] Error processing item ${item.id}:`, processError);
          
          // Update with error status and next retry time
          const newAttempts = (item.attempts || 0) + 1;
          const shouldRetry = newAttempts < maxAttempts;
          
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "error",
              attempts: newAttempts,
              last_error: processError.message,
              next_retry_at: shouldRetry 
                ? new Date(Date.now() + calculateBackoffDelay(newAttempts)).toISOString()
                : null,
            })
            .eq("id", item.id);

          results.failed++;
          if (shouldRetry) results.retried++;
          results.errors.push(`${item.id}: ${processError.message}`);
        } else if (processResult?.results?.skipped > 0) {
          // Item was skipped (e.g., already processed)
          await supabase
            .from("payment_reconcile_queue")
            .update({ status: "completed" })
            .eq("id", item.id);
          results.skipped++;
        } else if (processResult?.results?.orders_created > 0) {
          // Success!
          await supabase
            .from("payment_reconcile_queue")
            .update({ 
              status: "completed",
              processed_at: now,
            })
            .eq("id", item.id);
          results.success++;
          if (item.source === 'webhook') results.webhook_processed++;
        } else {
          // No orders created but no error - might need retry
          const newAttempts = (item.attempts || 0) + 1;
          const shouldRetry = newAttempts < maxAttempts;
          
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: shouldRetry ? "pending" : "error",
              attempts: newAttempts,
              last_error: "No order created",
              next_retry_at: shouldRetry 
                ? new Date(Date.now() + calculateBackoffDelay(newAttempts)).toISOString()
                : null,
            })
            .eq("id", item.id);
          
          results.skipped++;
          if (shouldRetry) results.retried++;
        }
        
        results.processed++;
      } catch (err) {
        console.error(`[bepaid-queue-cron] Exception processing item ${item.id}:`, err);
        
        const newAttempts = (item.attempts || 0) + 1;
        const shouldRetry = newAttempts < maxAttempts;
        
        await supabase
          .from("payment_reconcile_queue")
          .update({
            status: "error",
            attempts: newAttempts,
            last_error: err instanceof Error ? err.message : 'Unknown error',
            next_retry_at: shouldRetry 
              ? new Date(Date.now() + calculateBackoffDelay(newAttempts)).toISOString()
              : null,
          })
          .eq("id", item.id);
        
        results.failed++;
        results.processed++;
        results.errors.push(`${item.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    console.log(`[bepaid-queue-cron] Processing complete:`, results);

    // Check for items that exceeded max attempts and need attention
    const { data: stuckItems } = await supabase
      .from("payment_reconcile_queue")
      .select("id, bepaid_uid, customer_email, amount, currency, last_error")
      .gte("attempts", maxAttempts)
      .eq("status", "error")
      .limit(10);

    if (stuckItems && stuckItems.length > 0) {
      console.log(`[bepaid-queue-cron] Found ${stuckItems.length} stuck items that need manual attention`);
      
      const stuckAmount = stuckItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      
      if (stuckAmount > 100) {
        await supabase.functions.invoke("bepaid-discrepancy-alert", {
          body: {
            discrepancies: stuckItems.map(item => ({
              id: item.id,
              bepaid_uid: item.bepaid_uid,
              amount: item.amount,
              currency: item.currency,
              customer_email: item.customer_email,
              discrepancy_type: "stuck_items",
              last_error: item.last_error,
            })),
            threshold: 100,
            source: "queue_cron",
          },
        });
      }
    }

    // Log to audit_logs
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: "system",
      actor_label: "bepaid-queue-cron",
      action: "bepaid_queue_cron_run",
      meta: {
        processed: results.processed,
        success: results.success,
        failed: results.failed,
        skipped: results.skipped,
        retried: results.retried,
        stuck_items: stuckItems?.length || 0,
        errors_sample: results.errors.slice(0, 3),
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        processed: results.processed,
        orders_created: results.success,
        failed: results.failed,
        skipped: results.skipped,
        retried: results.retried,
        errors: results.errors,
        stuckItems: stuckItems?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[bepaid-queue-cron] Fatal error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
