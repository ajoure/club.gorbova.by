import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * PATCH: Queue processing with CORRECT webhook-first priority
 * 
 * Priority is NOT alphabetical - we use explicit CASE ordering:
 * 1. webhook (highest priority)
 * 2. api_sync
 * 3. csv (legacy)
 * 4. file_import (lowest - excluded by default)
 * 
 * - Respects next_retry_at for backoff
 * - Updates attempts counter
 * - Skips items with max attempts reached
 * - Logs results to audit_logs with system actor
 */

// Source priority mapping (lower = higher priority)
const SOURCE_PRIORITY: Record<string, number> = {
  'webhook': 1,       // Highest priority - real-time payments
  'api_sync': 2,      // API sync operations
  'csv': 3,           // Legacy CSV imports
  'file_import': 99,  // Lowest priority - excluded by default
};

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
    const excludeCancelled = body.excludeCancelled !== false; // Default: exclude soft-cancelled items

    console.log(`[bepaid-queue-cron] Starting queue processing, batch size: ${batchSize}, max attempts: ${maxAttempts}, excludeFileImport: ${excludeFileImport}`);

    const now = new Date().toISOString();

    // Get pending items with proper retry logic
    // Only get items where:
    // - status is pending or error (NOT cancelled!)
    // - attempts < maxAttempts
    // - next_retry_at is null OR <= now (ready for retry)
    let query = supabase
      .from("payment_reconcile_queue")
      .select("id, bepaid_uid, customer_email, amount, currency, attempts, status, next_retry_at, last_error, source, created_at")
      .in("status", ["pending", "error"])
      .lt("attempts", maxAttempts)
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`);
    
    // Exclude file_import by default - these need manual cleanup
    if (excludeFileImport) {
      query = query.neq("source", "file_import");
    }
    
    // Exclude soft-cancelled items (those with meta.soft_cancelled = true)
    // Note: This is a fallback if 'cancelled' status wasn't available
    
    const { data: allPendingItems, error: fetchError } = await query
      .order("created_at", { ascending: true })
      .limit(batchSize * 3); // Get more to sort properly

    if (fetchError) {
      throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    }

    if (!allPendingItems || allPendingItems.length === 0) {
      console.log("[bepaid-queue-cron] No pending items ready for processing");
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No pending items ready" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter out soft-cancelled items (identified by last_error prefix)
    let filteredItems = allPendingItems;
    if (excludeCancelled) {
      filteredItems = allPendingItems.filter(item => {
        // Exclude items with SOFT_CANCELLED or CANCELLED_BY_ADMIN in last_error
        const lastError = item.last_error || '';
        return !lastError.startsWith('SOFT_CANCELLED') && !lastError.startsWith('CANCELLED_BY_ADMIN');
      });
    }

    // CORRECT PRIORITY SORTING: Use explicit priority map, not alphabetical
    const sortedItems = filteredItems
      .map(item => ({
        ...item,
        priority: SOURCE_PRIORITY[item.source] || 50, // Unknown sources get medium priority
      }))
      .sort((a, b) => {
        // First by priority (lower = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Then by created_at (older first)
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      })
      .slice(0, batchSize); // Take only batchSize after sorting

    console.log(`[bepaid-queue-cron] Found ${allPendingItems.length} items, processing ${sortedItems.length} after filtering and priority sort`);
    
    // Log source distribution
    const sourceDistribution = sortedItems.reduce((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`[bepaid-queue-cron] Processing by source:`, sourceDistribution);

    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      webhook_processed: 0,
      by_source: {} as Record<string, number>,
      errors: [] as string[],
    };

    for (const item of sortedItems) {
      try {
        console.log(`[bepaid-queue-cron] Processing item ${item.id}, source=${item.source}, priority=${item.priority}, bepaid_uid=${item.bepaid_uid}, attempts=${item.attempts}`);
        
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

        // Track by source
        results.by_source[item.source] = (results.by_source[item.source] || 0) + 1;

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
      .select("id, bepaid_uid, customer_email, amount, currency, last_error, source")
      .gte("attempts", maxAttempts)
      .eq("status", "error")
      .neq("source", "file_import") // Don't count file_import as stuck - they're excluded
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
              source: item.source,
            })),
            threshold: 100,
            source: "queue_cron",
          },
        });
      }
    }

    // Log to audit_logs with system actor
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
        webhook_processed: results.webhook_processed,
        by_source: results.by_source,
        stuck_items: stuckItems?.length || 0,
        errors_sample: results.errors.slice(0, 3),
        priority_order: 'webhook > api_sync > csv > file_import (explicit)',
        timestamp: new Date().toISOString(),
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
        webhook_processed: results.webhook_processed,
        by_source: results.by_source,
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
