import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-fetch-transactions v2
 * 
 * РЕАЛИЗАЦИЯ: bePaid Reports API (POST /api/reports)
 * 
 * Особенности:
 * - Использует POST https://api.bepaid.by/api/reports
 * - X-Api-Version: 3 для пагинации (starting_after / has_more)
 * - Поддерживает refunds и все типы транзакций
 * - Режимы: diagnose, dry-run, execute
 * - STOP-предохранители: max_pages, max_items, max_runtime_ms
 */

interface SyncConfig {
  sync_window_hours: number;
  sync_overlap_hours: number;
  sync_page_size: number;
  sync_max_pages: number;
  sync_max_items: number;
  sync_max_runtime_ms: number;
}

const DEFAULT_CONFIG: SyncConfig = {
  sync_window_hours: 168, // 7 days
  sync_overlap_hours: 48,
  sync_page_size: 100,
  sync_max_pages: 20,
  sync_max_items: 500,
  sync_max_runtime_ms: 55000, // 55 seconds (edge function limit is 60s)
};

interface ParsedTrackingId {
  orderId: string | null;
  offerId: string | null;
  isValid: boolean;
}

function parseTrackingId(trackingId?: string): ParsedTrackingId {
  if (!trackingId) {
    return { orderId: null, offerId: null, isValid: false };
  }

  const parts = trackingId.split("_");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (parts.length === 2 && uuidRegex.test(parts[0])) {
    return {
      orderId: parts[0],
      offerId: uuidRegex.test(parts[1]) ? parts[1] : null,
      isValid: true,
    };
  }
  
  if (parts.length === 1 && uuidRegex.test(parts[0])) {
    return { orderId: parts[0], offerId: null, isValid: true };
  }
  
  return { orderId: null, offerId: null, isValid: false };
}

function normalizeTransactionStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'successful':
    case 'success':
      return 'successful';
    case 'failed':
    case 'declined':
    case 'expired':
    case 'error':
      return 'failed';
    case 'incomplete':
    case 'processing':
    case 'pending':
      return 'pending';
    case 'refunded':
    case 'voided':
      return 'refunded';
    default:
      return 'unknown';
  }
}

function determineTransactionType(tx: any): { type: string; isRefund: boolean } {
  const txType = tx.type?.toLowerCase() || '';
  
  if (txType === 'refund' || tx.refund_reason) {
    return { type: 'refund', isRefund: true };
  }
  if (txType === 'void') {
    return { type: 'void', isRefund: false };
  }
  if (txType === 'authorization') {
    return { type: 'authorization', isRefund: false };
  }
  if (txType === 'capture') {
    return { type: 'capture', isRefund: false };
  }
  return { type: 'payment', isRefund: false };
}

function calculateBackoffDelay(attempts: number): number {
  const delays = [5, 15, 45, 120, 360];
  const idx = Math.min(attempts, delays.length - 1);
  return delays[idx] * 60 * 1000;
}

function formatDateForBepaid(date: Date): string {
  // Format: YYYY-MM-DD hh:mm:ss
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Parse request body
  const body = await req.json().catch(() => ({}));
  const mode = body.mode || 'execute'; // 'diagnose' | 'dry-run' | 'execute'
  const forceFullSync = body.forceFullSync === true;
  const customWindowHours = body.windowHours;

  console.info(`[bepaid-fetch] Starting. Mode: ${mode}, forceFullSync: ${forceFullSync}`);

  // Create sync log entry
  const { data: syncLog } = await supabase
    .from("bepaid_sync_logs")
    .insert({
      sync_type: "reports_api_fetch",
      status: "running",
      meta: { mode, forceFullSync },
    })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    // Get bePaid credentials
    const { data: bepaidInstance } = await supabase
      .from("integration_instances")
      .select("id, config, last_successful_sync_at")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      console.error("No active bePaid integration found");
      await updateSyncLog(supabase, syncLogId, { status: "failed", error_message: "No bePaid integration" });
      return new Response(JSON.stringify({ error: "No bePaid integration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = bepaidInstance.config.shop_id;
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");

    if (!shopId || !secretKey) {
      console.error("Missing bePaid credentials");
      await updateSyncLog(supabase, syncLogId, { status: "failed", error_message: "Missing credentials" });
      return new Response(JSON.stringify({ error: "Missing credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build config with defaults
    const config: SyncConfig = {
      sync_window_hours: customWindowHours || bepaidInstance.config.sync_window_hours || DEFAULT_CONFIG.sync_window_hours,
      sync_overlap_hours: bepaidInstance.config.sync_overlap_hours || DEFAULT_CONFIG.sync_overlap_hours,
      sync_page_size: bepaidInstance.config.sync_page_size || DEFAULT_CONFIG.sync_page_size,
      sync_max_pages: bepaidInstance.config.sync_max_pages || DEFAULT_CONFIG.sync_max_pages,
      sync_max_items: bepaidInstance.config.sync_max_items || DEFAULT_CONFIG.sync_max_items,
      sync_max_runtime_ms: bepaidInstance.config.sync_max_runtime_ms || DEFAULT_CONFIG.sync_max_runtime_ms,
    };

    // Calculate date range
    const now = new Date();
    let fromDate: Date;

    if (forceFullSync) {
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
    } else if (bepaidInstance.last_successful_sync_at) {
      const watermark = new Date(bepaidInstance.last_successful_sync_at);
      fromDate = new Date(watermark.getTime() - config.sync_overlap_hours * 60 * 60 * 1000);
    } else {
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
    }

    const toDate = now;

    console.log(`[bepaid-fetch] Config: window=${config.sync_window_hours}h, overlap=${config.sync_overlap_hours}h, max_pages=${config.sync_max_pages}`);
    console.log(`[bepaid-fetch] Date range: from=${fromDate.toISOString()} to=${toDate.toISOString()}`);
    console.log(`[bepaid-fetch] Shop ID: ${shopId}`);

    await updateSyncLog(supabase, syncLogId, {
      shop_id: String(shopId),
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
    });

    const auth = btoa(`${shopId}:${secretKey}`);

    const results = {
      mode,
      transactions_fetched: 0,
      payments_found: 0,
      refunds_found: 0,
      already_exists: 0,
      queued_for_review: 0,
      upserted: 0,
      errors: 0,
      pages_fetched: 0,
      items_processed: 0,
      sample_uids: [] as string[],
      stopped_reason: null as string | null,
      details: [] as any[],
      dry_run_items: [] as any[],
    };

    // =================================================================
    // MAIN: Fetch transactions via Reports API
    // =================================================================
    
    let startingAfter: string | null = null;
    let hasMore = true;
    let pageNum = 0;

    while (hasMore && pageNum < config.sync_max_pages && results.items_processed < config.sync_max_items) {
      // Check runtime limit
      if (Date.now() - startTime > config.sync_max_runtime_ms) {
        results.stopped_reason = "max_runtime_reached";
        console.warn(`[bepaid-fetch] Stopping: max runtime ${config.sync_max_runtime_ms}ms reached`);
        break;
      }

      pageNum++;
      console.log(`[bepaid-fetch] Fetching page ${pageNum}...`);

      // Build Reports API request body
      const reportParams: any = {
        date_type: "created_at",
        from: formatDateForBepaid(fromDate),
        to: formatDateForBepaid(toDate),
        status: "all", // Get all statuses including refunds
        time_zone: "UTC",
      };

      if (startingAfter) {
        reportParams.starting_after = startingAfter;
      }

      const reportRequest = { report_params: reportParams };

      console.log(`[bepaid-fetch] Reports API request:`, JSON.stringify(reportRequest));

      let response: Response;
      try {
        response = await fetch("https://api.bepaid.by/api/reports", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Api-Version": "3", // Enable pagination
          },
          body: JSON.stringify(reportRequest),
        });
      } catch (fetchErr) {
        console.error(`[bepaid-fetch] Network error:`, fetchErr);
        results.errors++;
        break;
      }

      console.log(`[bepaid-fetch] Response status: ${response.status}`);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[bepaid-fetch] Reports API error: ${response.status} ${errText}`);
        
        // If 404 or method not allowed, try fallback to subscriptions only
        if (response.status === 404 || response.status === 405) {
          console.warn(`[bepaid-fetch] Reports API not available, falling back to subscriptions-only mode`);
          results.stopped_reason = "reports_api_not_available";
          break;
        }
        
        results.errors++;
        break;
      }

      const data = await response.json();
      
      // Extract transactions from response
      const transactions: any[] = data.transactions || data.data?.transactions || [];
      
      // Get pagination info
      hasMore = data.has_more === true;
      if (hasMore && transactions.length > 0) {
        startingAfter = data.last_object_id || transactions[transactions.length - 1]?.uid;
      }

      results.pages_fetched++;
      results.transactions_fetched += transactions.length;

      console.log(`[bepaid-fetch] Page ${pageNum}: got ${transactions.length} transactions, has_more=${hasMore}`);

      if (transactions.length === 0) {
        hasMore = false;
        break;
      }

      // Collect sample UIDs
      if (results.sample_uids.length < 10) {
        results.sample_uids.push(...transactions.slice(0, 10 - results.sample_uids.length).map(t => t.uid));
      }

      // Get existing payments in batch for deduplication
      const uids = transactions.map((t: any) => t.uid);
      const { data: existingPayments } = await supabase
        .from("payments_v2")
        .select("provider_payment_id")
        .in("provider_payment_id", uids);

      const existingUids = new Set((existingPayments || []).map((p) => p.provider_payment_id));

      // Also check queue
      const { data: existingQueue } = await supabase
        .from("payment_reconcile_queue")
        .select("bepaid_uid")
        .in("bepaid_uid", uids);

      const existingQueueUids = new Set((existingQueue || []).map((q) => q.bepaid_uid));

      // Process each transaction
      for (const tx of transactions) {
        results.items_processed++;
        
        if (results.items_processed > config.sync_max_items) {
          results.stopped_reason = "max_items_reached";
          console.warn(`[bepaid-fetch] Stopping: max items ${config.sync_max_items} reached`);
          break;
        }

        const uid = tx.uid;
        const { type: txType, isRefund } = determineTransactionType(tx);
        const normalizedStatus = normalizeTransactionStatus(tx.status);
        const parsed = parseTrackingId(tx.tracking_id);

        if (isRefund) {
          results.refunds_found++;
        } else {
          results.payments_found++;
        }

        // Check for duplicates
        if (existingUids.has(uid)) {
          results.already_exists++;
          continue;
        }

        // For dry-run mode, collect what would be done
        if (mode === 'dry-run') {
          results.dry_run_items.push({
            uid,
            type: txType,
            status: normalizedStatus,
            amount: tx.amount ? tx.amount / 100 : null,
            currency: tx.currency,
            email: tx.customer?.email,
            tracking_id: tx.tracking_id,
            parent_uid: tx.parent_uid || null,
            would_create: isRefund ? 'refund_payment' : 'payment',
            already_in_queue: existingQueueUids.has(uid),
          });
          continue;
        }

        if (mode === 'diagnose') {
          results.details.push({
            uid,
            type: txType,
            status: normalizedStatus,
            exists_in_payments: false,
            exists_in_queue: existingQueueUids.has(uid),
          });
          continue;
        }

        // EXECUTE MODE: Process transaction
        
        // For successful payments/refunds with valid tracking_id
        if (normalizedStatus === 'successful' && parsed.orderId) {
          // Check if order exists
          const { data: order } = await supabase
            .from("orders_v2")
            .select("id, profile_id, user_id")
            .eq("id", parsed.orderId)
            .maybeSingle();

          if (order) {
            // Create payment record
            const paymentData: any = {
              order_id: order.id,
              user_id: order.user_id || order.profile_id,
              profile_id: order.profile_id,
              amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100), // Negative for refunds
              currency: tx.currency || "BYN",
              status: "successful",
              provider: "bepaid",
              provider_payment_id: uid,
              provider_response: tx,
              paid_at: tx.paid_at || tx.created_at,
              card_last4: tx.credit_card?.last_4,
              card_brand: tx.credit_card?.brand,
              meta: {
                transaction_type: txType,
                tracking_id: tx.tracking_id,
                parent_uid: tx.parent_uid,
                source: "reports_api_sync",
              },
            };

            // If refund, link to parent payment
            if (isRefund && tx.parent_uid) {
              const { data: parentPayment } = await supabase
                .from("payments_v2")
                .select("id")
                .eq("provider_payment_id", tx.parent_uid)
                .maybeSingle();

              if (parentPayment) {
                paymentData.reference_payment_id = parentPayment.id;
              }
            }

            // Upsert payment
            const { error: upsertError } = await supabase
              .from("payments_v2")
              .upsert(paymentData, { 
                onConflict: "provider_payment_id",
                ignoreDuplicates: false,
              });

            if (upsertError) {
              console.error(`[bepaid-fetch] Payment upsert error:`, upsertError);
              results.errors++;
            } else {
              results.upserted++;
            }
            continue;
          }
        }

        // Queue for manual review if not already there
        if (!existingQueueUids.has(uid)) {
          const queueData: any = {
            provider: "bepaid",
            bepaid_uid: uid,
            tracking_id: tx.tracking_id,
            amount: tx.amount ? tx.amount / 100 : null,
            currency: tx.currency || "BYN",
            customer_email: tx.customer?.email,
            raw_payload: tx,
            source: "reports_api_sync",
            status: "pending",
            status_normalized: normalizedStatus,
            transaction_type: txType,
            paid_at: tx.paid_at,
            created_at_bepaid: tx.created_at,
            reference_transaction_uid: tx.parent_uid || null,
            card_last4: tx.credit_card?.last_4,
            card_brand: tx.credit_card?.brand,
          };

          const { error: queueError } = await supabase
            .from("payment_reconcile_queue")
            .upsert(queueData, {
              onConflict: "provider,bepaid_uid",
              ignoreDuplicates: true,
            });

          if (!queueError) {
            results.queued_for_review++;
          } else {
            console.error(`[bepaid-fetch] Queue upsert error:`, queueError);
          }
        }
      }

      // Break if we hit max items
      if (results.stopped_reason) break;
    }

    // Check if stopped early
    if (pageNum >= config.sync_max_pages && hasMore) {
      results.stopped_reason = results.stopped_reason || "max_pages_reached";
    }

    // Update watermark on success (only in execute mode)
    if (mode === 'execute' && results.errors === 0) {
      await supabase
        .from("integration_instances")
        .update({ last_successful_sync_at: new Date().toISOString() })
        .eq("id", bepaidInstance.id);
    }

    // Finalize sync log
    await updateSyncLog(supabase, syncLogId, {
      status: results.stopped_reason ? "partial" : "completed",
      completed_at: new Date().toISOString(),
      transactions_fetched: results.transactions_fetched,
      pages_fetched: results.pages_fetched,
      processed: results.items_processed,
      queued: results.queued_for_review,
      already_exists: results.already_exists,
      errors: results.errors,
      sample_uids: results.sample_uids,
      meta: {
        mode,
        payments_found: results.payments_found,
        refunds_found: results.refunds_found,
        upserted: results.upserted,
        stopped_reason: results.stopped_reason,
        duration_ms: Date.now() - startTime,
      },
    });

    console.log(`[bepaid-fetch] Completed in ${Date.now() - startTime}ms`);
    console.log(`[bepaid-fetch] Results:`, JSON.stringify({
      transactions_fetched: results.transactions_fetched,
      payments_found: results.payments_found,
      refunds_found: results.refunds_found,
      already_exists: results.already_exists,
      queued_for_review: results.queued_for_review,
      upserted: results.upserted,
      stopped_reason: results.stopped_reason,
    }));

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[bepaid-fetch] Fatal error:", error);
    
    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      error_message: String(error),
      completed_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ error: String(error), mode }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function updateSyncLog(supabase: any, syncLogId: string | null, updates: any) {
  if (!syncLogId) return;
  
  await supabase
    .from("bepaid_sync_logs")
    .update(updates)
    .eq("id", syncLogId);
}
