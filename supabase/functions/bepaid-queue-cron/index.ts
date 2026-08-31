import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeQueueCronRequest } from "./auth.ts";
import {
  isStaleProcessingItem,
  normalizeQueueRunOptions,
  staleProcessingCutoff,
  staleTerminalReason,
} from "./policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-key",
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
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const authorization = authorizeQueueCronRequest(req, {
      serviceRoleKey: supabaseServiceKey,
      cronSecret,
    });
    if (!authorization.ok) {
      return new Response(
        JSON.stringify({ success: false, error: authorization.error }),
        {
          status: authorization.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fail before claiming any rows: the downstream worker requires this key.
    if (!cronSecret) throw new Error("CRON_SECRET is not configured");

    const body = await req.json().catch(() => ({}));
    const {
      dryRun,
      queueItemId,
      maxAttempts,
      batchSize,
      excludeFileImport,
      excludeCancelled,
    } = normalizeQueueRunOptions(body);

    console.log(`[bepaid-queue-cron] Starting queue processing, batch size: ${batchSize}, max attempts: ${maxAttempts}, excludeFileImport: ${excludeFileImport}`);

    const now = new Date().toISOString();
    const processingCutoff = staleProcessingCutoff(new Date(now));

    // Get retryable items with proper retry logic
    // Only get items where:
    // - status is pending/error and retry is due, OR processing is stale
    // - attempts < maxAttempts for ordinary retries; exhausted stale claims
    //   must still leave processing and become an explicit terminal error.
    // Fresh processing rows remain invisible to overlapping workers.
    let query = supabase
      .from("payment_reconcile_queue")
      .select("id, bepaid_uid, customer_email, amount, currency, attempts, status, next_retry_at, last_error, source, created_at, updated_at, last_attempt_at")
      .limit(queueItemId ? 1 : batchSize * 3);

    if (queueItemId) {
      // Admin/support recovery: one exact row only. This intentionally accepts
      // `successful` rows produced by bepaid-recover-payment.
      query = query.eq("id", queueItemId);
    } else {
      query = query
        .or(
          `and(status.in.(pending,error),attempts.lt.${maxAttempts},or(next_retry_at.is.null,next_retry_at.lte.${now})),and(status.eq.processing,updated_at.lt.${processingCutoff})`,
        );
    }
    
    // Exclude file_import by default - these need manual cleanup
    if (excludeFileImport && !queueItemId) {
      // Abandoned imports are not replayed, but must not stay processing forever.
      query = query.or("source.neq.file_import,status.eq.processing");
    }
    
    // Exclude soft-cancelled items (those with meta.soft_cancelled = true)
    // Note: This is a fallback if 'cancelled' status wasn't available
    
    const { data: allPendingItems, error: fetchError } = await query
      .order("created_at", { ascending: true });

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
        if (isStaleProcessingItem(item, processingCutoff)) return true;
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
      .slice(0, queueItemId ? 1 : batchSize); // exact item or bounded batch

    // A dry-run is a read-only preview: no claim, audit insert, worker or alert.
    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        candidates: sortedItems.map(item => ({
          id: item.id,
          status: item.status,
          attempts: item.attempts,
          action: item.status === "processing" && !isStaleProcessingItem(item, processingCutoff)
            ? "skip_fresh_claim"
            : isStaleProcessingItem(item, processingCutoff)
            ? staleTerminalReason(item, { maxAttempts, excludeCancelled, excludeFileImport, queueItemId }) || "recover_stale"
            : "process",
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
      stale_recovered: 0,
      claim_conflicts: 0,
      stale_terminal: 0,
      webhook_processed: 0,
      by_source: {} as Record<string, number>,
      errors: [] as string[],
    };

    for (const item of sortedItems) {
      let claimOwned = false;
      try {
        console.log(`[bepaid-queue-cron] Processing item ${item.id}, source=${item.source}, priority=${item.priority}, bepaid_uid=${item.bepaid_uid}, attempts=${item.attempts}`);

        const staleRecovery = isStaleProcessingItem(item, processingCutoff);
        const softCancelled = excludeCancelled &&
          (item.last_error?.startsWith("SOFT_CANCELLED") ||
            item.last_error?.startsWith("CANCELLED_BY_ADMIN"));
        if (item.status === "processing" && !staleRecovery) {
          results.claim_conflicts++;
          continue;
        }
        const reason = staleRecovery
          ? staleTerminalReason(item, { maxAttempts, excludeCancelled, excludeFileImport, queueItemId })
          : null;
        if (reason) {
          const { data: released, error: releaseError } = await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "error",
              last_error: softCancelled
                ? `${item.last_error}; ${reason}`
                : `${reason}: ${item.last_error || "worker interrupted"}`,
              next_retry_at: null,
            })
            .eq("id", item.id)
            .eq("status", item.status)
            .eq("updated_at", item.updated_at)
            .select("id")
            .maybeSingle();
          if (releaseError) throw new Error(`Stale claim release failed: ${releaseError.message}`);
          if (!released) results.claim_conflicts++;
          else {
            results.stale_terminal++;
            results.failed++;
            results.processed++;
            results.errors.push(`${item.id}: ${reason}`);
          }
          continue;
        }
        const claimedAttempts = staleRecovery
          ? (item.attempts || 0) + 1
          : (item.attempts || 0);

        // CAS claim: overlapping cron runs must never process the same row.
        const { data: claimed, error: claimError } = await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "processing",
            last_attempt_at: now,
            attempts: claimedAttempts,
          })
          .eq("id", item.id)
          .eq("status", item.status)
          .eq("updated_at", item.updated_at)
          .select("id")
          .maybeSingle();

        if (claimError) {
          throw new Error(`Queue claim failed: ${claimError.message}`);
        }
        if (!claimed) {
          results.claim_conflicts++;
          console.log(`[bepaid-queue-cron] CAS claim skipped for item ${item.id}: row changed concurrently`);
          continue;
        }
        claimOwned = true;
        if (staleRecovery) results.stale_recovered++;

        const { data: processResult, error: processError } = await supabase.functions.invoke(
          "bepaid-auto-process",
          {
            body: { queueItemId: item.id },
            headers: { "x-internal-key": cronSecret },
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
        } else if ((processResult?.results?.errors?.length || 0) > 0) {
          const message = processResult.results.errors.join('; ');
          const newAttempts = (item.attempts || 0) + 1;
          const shouldRetry = newAttempts < maxAttempts;
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: shouldRetry ? "pending" : "error",
              attempts: newAttempts,
              last_error: message,
              next_retry_at: shouldRetry
                ? new Date(Date.now() + calculateBackoffDelay(newAttempts)).toISOString()
                : null,
            })
            .eq("id", item.id);
          results.failed++;
          if (shouldRetry) results.retried++;
          results.errors.push(`${item.id}: ${message}`);
        } else if (processResult?.results?.orders_created > 0 || processResult?.results?.orders_reconciled > 0) {
          // Canonical payment, order and access were verified.
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "completed",
              processed_at: now,
              last_error: null,
              next_retry_at: null,
            })
            .eq("id", item.id);
          results.success++;
          if (item.source === 'webhook') results.webhook_processed++;
        } else if (processResult?.results?.already_materialized > 0) {
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "completed",
              processed_at: now,
              last_error: null,
              next_retry_at: null,
            })
            .eq("id", item.id);
          results.skipped++;
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

        // A failed/ambiguous CAS is not ownership. Never overwrite another
        // worker's row from the error handler when our claim did not succeed.
        if (!claimOwned) {
          results.failed++;
          results.errors.push(`${item.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          continue;
        }
        
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
        stale_recovered: results.stale_recovered,
        claim_conflicts: results.claim_conflicts,
        stale_terminal: results.stale_terminal,
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
        stale_recovered: results.stale_recovered,
        claim_conflicts: results.claim_conflicts,
        stale_terminal: results.stale_terminal,
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
