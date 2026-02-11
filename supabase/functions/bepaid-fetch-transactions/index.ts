import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-fetch-transactions v4
 * 
 * CRITICAL UPDATE: Added Reports API support for manual invoice payments
 * 
 * Режимы:
 * - BULK (default): Пробирует несколько endpoints, качает транзакции
 * - RECOVER: Восстанавливает потерянные платежи по bepaid_uid из orders
 * 
 * Особенности:
 * - Probe mode: тестирует endpoints и выбирает рабочий
 * - Reports API: POST-запрос для ручных ссылок (инвойсов)
 * - Поддержка refunds с наследованием profile_id от родителя
 * - Буфер ±12 часов для часовых поясов
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
  sync_max_runtime_ms: 55000,
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
  const txType = (tx.type || tx.transaction_type || '').toLowerCase();
  const amount = tx.amount ? Number(tx.amount) : 0;
  
  // RULE #1: If amount is NEGATIVE, it's a REFUND regardless of type label
  // This fixes imports/reports where refunds come as 'payment' with negative amount
  if (amount < 0) {
    console.log(`[bepaid-fetch] Detected refund by negative amount: ${amount / 100}`);
    return { type: 'refund', isRefund: true };
  }
  
  // Check type/status for refund indicators
  if (txType === 'refund' || tx.refund_reason || tx.status === 'refunded') {
    return { type: 'refund', isRefund: true };
  }
  if (txType === 'chargeback') {
    return { type: 'chargeback', isRefund: true };
  }
  if (txType === 'void' || tx.status === 'voided') {
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

interface ProbeResult {
  success: boolean;
  endpoint: string;
  status: number;
  error?: string;
  transactionCount?: number;
}

// ============================================================
// Reports API - POST request for manual invoice payments
// ============================================================
interface ReportsAPIResult {
  success: boolean;
  transactions: any[];
  error?: string;
  endpoint_used?: string;
}

async function fetchReportsAPI(
  auth: string,
  shopId: string,
  fromDate: Date,
  toDate: Date
): Promise<ReportsAPIResult> {
  const endpoints = [
    "https://api.bepaid.by/api/reports",
    "https://gateway.bepaid.by/api/reports",
    "https://api.bepaid.by/reports",
    "https://gateway.bepaid.by/reports",
  ];

  // Format dates for bePaid Reports API (with timezone)
  const formatDate = (d: Date) => {
    return d.toISOString().replace('T', ' ').substring(0, 19);
  };

  const requestBody = {
    report_params: {
      date_type: "created_at",
      from: formatDate(fromDate),
      to: formatDate(toDate),
      status: "all",
      payment_method_type: "all",
      time_zone: "Europe/Minsk"
    }
  };

  console.log(`[bepaid-fetch] Reports API request body:`, JSON.stringify(requestBody));

  for (const endpoint of endpoints) {
    try {
      console.log(`[bepaid-fetch] Trying Reports API: ${endpoint}`);
      
      const response = await fetch(endpoint, {
        method: "POST",  // CRITICAL: Reports API requires POST!
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Api-Version": "2",
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[bepaid-fetch] Reports API ${endpoint}: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        // Reports API may return data in different structures
        const transactions = data.transactions || data.data?.transactions || data.items || [];
        console.log(`[bepaid-fetch] Reports API returned ${transactions.length} transactions from ${endpoint}`);
        return { 
          success: true, 
          transactions, 
          endpoint_used: endpoint 
        };
      } else {
        const errText = await response.text();
        console.log(`[bepaid-fetch] Reports API ${endpoint} error: ${errText.substring(0, 200)}`);
      }
    } catch (err) {
      console.error(`[bepaid-fetch] Reports API error for ${endpoint}:`, err);
    }
  }

  return { success: false, transactions: [], error: "All Reports API endpoints failed" };
}

// Probe bePaid endpoints to find working one
async function probeEndpoints(
  auth: string, 
  shopId: string,
  fromDate: Date,
  toDate: Date,
  perPage: number
): Promise<{ workingEndpoint: string | null; probeResults: ProbeResult[] }> {
  const fromDateISO = fromDate.toISOString();
  const toDateISO = toDate.toISOString();

  const buildUrl = (base: string, includeShopId: boolean) => {
    const params = new URLSearchParams({
      created_at_from: fromDateISO,
      created_at_to: toDateISO,
      per_page: String(perPage),
      ...(includeShopId ? { shop_id: String(shopId) } : {}),
    });
    return `${base}?${params.toString()}`;
  };

  // Endpoints ordered by likelihood of working (based on bepaid-raw-transactions)
  // Extended with Reports API endpoints as fallback
  const candidates = [
    { name: "gateway:/transactions", url: buildUrl("https://gateway.bepaid.by/transactions", false) },
    { name: "gateway:/transactions?shop_id", url: buildUrl("https://gateway.bepaid.by/transactions", true) },
    { name: "gateway:/api/v1/transactions", url: buildUrl("https://gateway.bepaid.by/api/v1/transactions", false) },
    { name: "api:/transactions", url: buildUrl("https://api.bepaid.by/transactions", false) },
    { name: "api:/transactions?shop_id", url: buildUrl("https://api.bepaid.by/transactions", true) },
    // Reports API endpoints (alternative for some accounts)
    { name: "api:/reports/transactions", url: buildUrl("https://api.bepaid.by/reports/transactions", false) },
    { name: "gateway:/reports/transactions", url: buildUrl("https://gateway.bepaid.by/reports/transactions", false) },
    { name: "checkout:/transactions", url: buildUrl("https://checkout.bepaid.by/transactions", false) },
  ];

  const probeResults: ProbeResult[] = [];
  let workingEndpoint: string | null = null;

  for (const candidate of candidates) {
    console.log(`[probe] Testing ${candidate.name}: ${candidate.url}`);
    
    try {
      const response = await fetch(candidate.url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "X-Api-Version": "3",
        },
      });

      const result: ProbeResult = {
        success: response.ok,
        endpoint: candidate.name,
        status: response.status,
      };

      if (response.ok) {
        const data = await response.json();
        const txList = data.transactions || data.data?.transactions || [];
        result.transactionCount = txList.length;
        
        if (!workingEndpoint) {
          workingEndpoint = candidate.url.split('?')[0]; // Base URL without params
          console.log(`[probe] Found working endpoint: ${candidate.name} (${txList.length} transactions)`);
        }
      } else {
        const errText = await response.text();
        result.error = errText.substring(0, 200);
      }

      probeResults.push(result);
      
      // Stop probing once we found a working endpoint
      if (workingEndpoint) break;
      
    } catch (err) {
      probeResults.push({
        success: false,
        endpoint: candidate.name,
        status: 0,
        error: String(err).substring(0, 200),
      });
    }
  }

  return { workingEndpoint, probeResults };
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
  const syncMode = body.syncMode || 'BULK'; // 'BULK' | 'RECOVER'
  const forceFullSync = body.forceFullSync === true;
  const customWindowHours = body.windowHours;
  const maxRecoverItems = body.maxRecoverItems || 50;
  
  // Explicit date parameters for Discovery mode
  const fromDateExplicit = body.fromDate as string | undefined; // "2026-01-16"
  const toDateExplicit = body.toDate as string | undefined;     // "2026-01-16"

  console.info(`[bepaid-fetch] Starting. Mode: ${mode}, SyncMode: ${syncMode}, forceFullSync: ${forceFullSync}`);

  // Create sync log entry
  const { data: syncLog } = await supabase
    .from("bepaid_sync_logs")
    .insert({
      sync_type: syncMode === 'RECOVER' ? "recover" : "bulk_fetch",
      status: "running",
      meta: { mode, syncMode, forceFullSync },
    })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error("Missing bePaid credentials:", credsResult.error);
      await updateSyncLog(supabase, syncLogId, { status: "failed", error_message: "Missing credentials: " + credsResult.error });
      return new Response(JSON.stringify({ error: credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bepaidCreds = credsResult;
    const shopId = bepaidCreds.shop_id;
    const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');
    const bepaidInstance = { 
      config: { 
        shop_id: shopId, 
        secret_key: bepaidCreds.secret_key,
        sync_window_hours: DEFAULT_CONFIG.sync_window_hours,
        sync_overlap_hours: DEFAULT_CONFIG.sync_overlap_hours,
        sync_page_size: DEFAULT_CONFIG.sync_page_size,
        sync_max_pages: DEFAULT_CONFIG.sync_max_pages,
        sync_max_items: DEFAULT_CONFIG.sync_max_items,
        sync_max_runtime_ms: DEFAULT_CONFIG.sync_max_runtime_ms
      }
    }; // Mock for config compatibility below

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
    let toDate: Date;

    // Check for explicit dates (Discovery mode)
    if (fromDateExplicit && toDateExplicit) {
      // Explicit dates from request — Discovery mode
      // Extend range by ±12 hours to handle timezone differences (+03:00 etc)
      fromDate = new Date(`${fromDateExplicit}T00:00:00Z`);
      fromDate.setHours(fromDate.getHours() - 12);
      
      toDate = new Date(`${toDateExplicit}T23:59:59Z`);
      toDate.setHours(toDate.getHours() + 12);
      
      console.log(`[bepaid-fetch] DISCOVERY mode: explicit dates ${fromDateExplicit} to ${toDateExplicit}`);
      console.log(`[bepaid-fetch] Extended range (±12h TZ buffer): ${fromDate.toISOString()} to ${toDate.toISOString()}`);
    } else if (fromDateExplicit) {
      // Only fromDate provided
      fromDate = new Date(`${fromDateExplicit}T00:00:00Z`);
      toDate = now;
      console.log(`[bepaid-fetch] DISCOVERY mode: from ${fromDateExplicit} to now`);
    } else if (forceFullSync) {
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
      toDate = now;
    } else if (false) { // PATCH-P0.9.1: disabled last_successful_sync_at logic as we removed the DB fetch
      // const watermark = new Date(bepaidInstance.last_successful_sync_at);
      // fromDate = new Date(watermark.getTime() - config.sync_overlap_hours * 60 * 60 * 1000);
      // toDate = now;
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
      toDate = now;
    } else {
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
      toDate = now;
    }

    console.log(`[bepaid-fetch] Config: window=${config.sync_window_hours}h, max_pages=${config.sync_max_pages}`);
    console.log(`[bepaid-fetch] Date range: from=${fromDate.toISOString()} to=${toDate.toISOString()}`);
    console.log(`[bepaid-fetch] Shop ID: ${shopId}`);

    const results: any = {
      mode,
      syncMode,
      transactions_fetched: 0,
      payments_found: 0,
      refunds_found: 0,
      already_exists: 0,
      queued_for_review: 0,
      upserted: 0,
      recovered: 0,
      errors: 0,
      pages_fetched: 0,
      items_processed: 0,
      sample_uids: [] as string[],
      stopped_reason: null as string | null,
      probe_results: [] as ProbeResult[],
      working_endpoint: null as string | null,
      details: [] as any[],
      dry_run_items: [] as any[],
      // NEW: Manual invoice tracking
      manual_invoices_added: 0,
      manual_invoices_linked: 0,
      refunds_linked: 0,
      refunds_orphan: 0,
      missing_parent: 0,
      upsert_errors: [] as any[],
    };

    // ==================================================================
    // RECOVER MODE: Restore lost payments by fetching individual UIDs
    // ==================================================================
    if (syncMode === 'RECOVER') {
      console.log(`[bepaid-fetch] RECOVER mode: Looking for paid orders without payments...`);
      
      // Use raw SQL to find orders without payments efficiently
      // This is more efficient than filtering in memory
      const { data: ordersWithoutPayments, error: recoverError } = await supabase
        .rpc('get_paid_orders_without_payments', { limit_count: maxRecoverItems });
      
      // Fallback: if RPC doesn't exist, use manual approach
      let lostOrders = ordersWithoutPayments;
      if (recoverError) {
        console.log(`[bepaid-fetch] RPC not available, using manual approach: ${recoverError.message}`);
        
        // Get all paid orders with bepaid_uid
        const { data: allPaidOrders } = await supabase
          .from("orders_v2")
          .select("id, order_number, final_price, profile_id, user_id, meta, created_at")
          .eq("status", "paid")
          .not("meta->bepaid_uid", "is", null)
          .order("created_at", { ascending: false })
          .limit(200); // Get more to find ones without payments
        
        if (allPaidOrders && allPaidOrders.length > 0) {
          // Check which have payments
          const orderIds = allPaidOrders.map(o => o.id);
          const { data: existingPayments } = await supabase
            .from("payments_v2")
            .select("order_id")
            .in("order_id", orderIds);
          
          const paidOrderIds = new Set((existingPayments || []).map(p => p.order_id));
          lostOrders = allPaidOrders.filter(o => !paidOrderIds.has(o.id)).slice(0, maxRecoverItems);
        } else {
          lostOrders = [];
        }
      }

      if (!lostOrders || lostOrders.length === 0) {
        console.log(`[bepaid-fetch] RECOVER: No orders without payments found`);
        results.stopped_reason = "no_orders_to_recover";
      } else {
        console.log(`[bepaid-fetch] RECOVER: Found ${lostOrders.length} orders without payments`);

        for (const order of lostOrders) {
          if (Date.now() - startTime > config.sync_max_runtime_ms) {
            results.stopped_reason = "max_runtime_reached";
            break;
          }

          results.items_processed++;
          const bepaidUid = order.meta?.bepaid_uid || order.meta?.transaction_uid;
          
          if (!bepaidUid) {
            console.log(`[bepaid-fetch] RECOVER: Order ${order.order_number} has no bepaid_uid, skipping`);
            continue;
          }

          console.log(`[bepaid-fetch] RECOVER: Fetching transaction ${bepaidUid} for order ${order.order_number}`);

          // Fetch single transaction by UID
          try {
            const txUrl = `https://gateway.bepaid.by/transactions/${bepaidUid}`;
            const response = await fetch(txUrl, {
              method: "GET",
              headers: {
                Authorization: `Basic ${auth}`,
                Accept: "application/json",
              },
            });

            if (!response.ok) {
              console.error(`[bepaid-fetch] RECOVER: Failed to fetch ${bepaidUid}: ${response.status}`);
              results.errors++;
              continue;
            }

            const data = await response.json();
            const tx = data.transaction || data;

            if (!tx || !tx.uid) {
              console.error(`[bepaid-fetch] RECOVER: Invalid response for ${bepaidUid}`);
              results.errors++;
              continue;
            }

            results.sample_uids.push(tx.uid);
            const { type: txType, isRefund } = determineTransactionType(tx);
            const normalizedStatus = normalizeTransactionStatus(tx.status);

            if (mode === 'dry-run') {
              results.dry_run_items.push({
                order_id: order.id,
                order_number: order.order_number,
                uid: tx.uid,
                status: normalizedStatus,
                amount: tx.amount ? tx.amount / 100 : order.final_price,
                would_create: 'payment',
              });
              continue;
            }

            if (mode === 'execute' && normalizedStatus === 'successful') {
              // Create payment record
              // IMPORTANT: user_id should be auth user id, NOT profile_id
              // profile_id is separate field
              const paymentData = {
                order_id: order.id,
                user_id: order.user_id, // Auth user ID, can be null
                profile_id: order.profile_id,
                amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100),
                currency: tx.currency || "BYN",
                status: "successful",
                provider: "bepaid",
                provider_payment_id: tx.uid,
                provider_response: tx,
                paid_at: tx.paid_at || tx.created_at,
                card_last4: tx.credit_card?.last_4,
                card_brand: tx.credit_card?.brand,
                meta: {
                  transaction_type: txType,
                  source: "recover_sync",
                  tracking_id: tx.tracking_id,
                },
              };

              // Check if payment already exists before inserting
              const { data: existingPayment } = await supabase
                .from("payments_v2")
                .select("id")
                .eq("provider_payment_id", tx.uid)
                .maybeSingle();

              if (existingPayment) {
                console.log(`[bepaid-fetch] RECOVER: Payment already exists for ${tx.uid}`);
                results.already_exists++;
                continue;
              }

              const { error: insertError } = await supabase
                .from("payments_v2")
                .insert(paymentData);

              if (insertError) {
                console.error(`[bepaid-fetch] RECOVER: Insert error:`, insertError);
                results.errors++;
              } else {
                results.recovered++;
                results.upserted++;
                console.log(`[bepaid-fetch] RECOVER: Created payment for order ${order.order_number}`);
              }
            }

          } catch (err) {
            console.error(`[bepaid-fetch] RECOVER: Exception for ${bepaidUid}:`, err);
            results.errors++;
          }
        }
      }

      // Finalize RECOVER mode
      await updateSyncLog(supabase, syncLogId, {
        status: results.stopped_reason ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        processed: results.items_processed,
        errors: results.errors,
        sample_uids: results.sample_uids,
        meta: {
          mode,
          syncMode,
          recovered: results.recovered,
          duration_ms: Date.now() - startTime,
          stopped_reason: results.stopped_reason,
        },
      });

      // Audit log
      await supabase.from("audit_logs").insert({
        actor_user_id: null,
        actor_type: "system",
        actor_label: "bepaid-fetch-transactions",
        action: "bepaid_fetch_transactions_cron",
        meta: {
          mode,
          syncMode: 'RECOVER',
          items_processed: results.items_processed,
          recovered: results.recovered,
          errors: results.errors,
          stopped_reason: results.stopped_reason,
          duration_ms: Date.now() - startTime,
        },
      });

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================================================================
    // BULK MODE: Probe endpoints and fetch transactions
    // ==================================================================
    
    // Step 1: Probe endpoints to find working one
    console.log(`[bepaid-fetch] BULK mode: Probing endpoints...`);
    const { workingEndpoint, probeResults } = await probeEndpoints(
      auth, 
      shopId, 
      fromDate, 
      toDate, 
      config.sync_page_size
    );

    results.probe_results = probeResults;
    results.working_endpoint = workingEndpoint;

    await updateSyncLog(supabase, syncLogId, {
      shop_id: String(shopId),
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
      meta: { 
        mode, 
        syncMode,
        probe_results: probeResults,
        working_endpoint: workingEndpoint,
      },
    });

    if (!workingEndpoint) {
      console.log(`[bepaid-fetch] No bulk endpoint found, trying Reports API (POST)...`);
      
      // FIRST: Try Reports API (POST) - captures manual invoice payments
      const reportsResult = await fetchReportsAPI(auth, String(shopId), fromDate, toDate);
      
      if (reportsResult.success && reportsResult.transactions.length > 0) {
        console.log(`[bepaid-fetch] Reports API success: ${reportsResult.transactions.length} transactions from ${reportsResult.endpoint_used}`);
        results.reports_api_used = true;
        results.reports_api_count = reportsResult.transactions.length;
        results.reports_api_endpoint = reportsResult.endpoint_used;
        
        // Process transactions from Reports API
        for (const tx of reportsResult.transactions) {
          results.items_processed++;
          
          const uid = tx.uid || tx.id;
          if (!uid) continue;
          
          const { type: txType, isRefund } = determineTransactionType(tx);
          const normalizedStatus = normalizeTransactionStatus(tx.status);
          const parsed = parseTrackingId(tx.tracking_id);
          
          if (isRefund) {
            results.refunds_found++;
          } else {
            results.payments_found++;
          }
          
          results.sample_uids.push(uid);
          results.transactions_fetched++;
          
          // Check if already exists
          const { data: existingPayment } = await supabase
            .from("payments_v2")
            .select("id")
            .eq("provider_payment_id", uid)
            .maybeSingle();
            
          if (existingPayment) {
            results.already_exists++;
            continue;
          }
          
          if (mode === 'dry-run') {
            results.dry_run_items.push({
              uid,
              type: txType,
              status: normalizedStatus,
              amount: tx.amount ? tx.amount / 100 : null,
              source: 'reports_api',
            });
            continue;
          }
          
          if (mode === 'execute' && parsed.orderId) {
            const { data: order } = await supabase
              .from("orders_v2")
              .select("id, profile_id, user_id")
              .eq("id", parsed.orderId)
              .maybeSingle();
              
            if (order) {
              const paymentData: any = {
                order_id: order.id,
                user_id: order.user_id,
                profile_id: order.profile_id,
                amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100),
                currency: tx.currency || "BYN",
                status: normalizedStatus,
                transaction_type: txType,
                provider: "bepaid",
                provider_payment_id: uid,
                provider_response: tx,
                paid_at: tx.paid_at || tx.created_at,
                card_last4: tx.credit_card?.last_4,
                card_brand: tx.credit_card?.brand,
                meta: {
                  transaction_type: txType,
                  source: "reports_api",
                  tracking_id: tx.tracking_id,
                },
              };
              
              // Handle refund linking with profile_id inheritance
              if (isRefund) {
                let parentUid = tx.parent_uid || tx.parent_transaction_uid;
                
                if (parentUid) {
                  const { data: parentPayment } = await supabase
                    .from("payments_v2")
                    .select("id, profile_id, user_id, order_id")
                    .eq("provider_payment_id", parentUid)
                    .maybeSingle();
                    
                  if (parentPayment) {
                    paymentData.reference_payment_id = parentPayment.id;
                    paymentData.profile_id = parentPayment.profile_id;
                    paymentData.user_id = parentPayment.user_id;
                    if (!paymentData.order_id) {
                      paymentData.order_id = parentPayment.order_id;
                    }
                    console.log(`[bepaid-fetch] Reports API: Linked refund ${uid} to parent, profile: ${parentPayment.profile_id}`);
                  }
                }
              }
              
              const { error: upsertError } = await supabase
                .from("payments_v2")
                .upsert(paymentData, { onConflict: "provider_payment_id" });
                
              if (!upsertError) {
                results.upserted++;
              } else {
                console.error(`[bepaid-fetch] Reports API upsert error:`, upsertError);
                results.errors++;
              }
              continue;
            }
          }
          
          // Queue for manual review if no order found
          const queueData: any = {
            provider: "bepaid",
            bepaid_uid: uid,
            tracking_id: tx.tracking_id,
            amount: tx.amount ? tx.amount / 100 : null,
            currency: tx.currency || "BYN",
            customer_email: tx.customer?.email,
            raw_payload: tx,
            source: "reports_api",
            status: "pending",
            status_normalized: normalizedStatus,
            transaction_type: txType,
            paid_at: tx.paid_at,
            created_at_bepaid: tx.created_at,
          };
          
          const { error: queueError } = await supabase
            .from("payment_reconcile_queue")
            .upsert(queueData, { onConflict: "provider,bepaid_uid", ignoreDuplicates: true });
            
          if (!queueError) {
            results.queued_for_review++;
          }
        }
        
        // Skip UID fallback if Reports API worked
      } else {
        console.log(`[bepaid-fetch] Reports API failed or returned 0 transactions, trying UID fallback...`);
      }
      
      // FALLBACK: Try to recover transactions from payment_reconcile_queue by UID
      const { data: queueItems } = await supabase
        .from("payment_reconcile_queue")
        .select("bepaid_uid")
        .gte("created_at_bepaid", fromDate.toISOString())
        .lte("created_at_bepaid", toDate.toISOString())
        .eq("status", "pending")
        .limit(100);
      
      if (queueItems && queueItems.length > 0) {
        console.log(`[bepaid-fetch] Fallback: Found ${queueItems.length} UIDs in queue to recover`);
        results.fallback_mode = true;
        results.fallback_source = "payment_reconcile_queue";
        
        for (const item of queueItems) {
          if (Date.now() - startTime > config.sync_max_runtime_ms) {
            results.stopped_reason = "max_runtime_reached";
            break;
          }
          
          try {
            const uidResponse = await fetch(
              `https://gateway.bepaid.by/transactions/${item.bepaid_uid}`,
              {
                headers: {
                  Authorization: `Basic ${auth}`,
                  Accept: "application/json",
                },
              }
            );
            
            if (uidResponse.ok) {
              const txData = await uidResponse.json();
              const tx = txData.transaction || txData;
              
              if (tx && tx.uid) {
                results.transactions_fetched++;
                const { type: txType, isRefund } = determineTransactionType(tx);
                const normalizedStatus = normalizeTransactionStatus(tx.status);
                const parsed = parseTrackingId(tx.tracking_id);
                
                if (parsed.orderId) {
                  const { data: order } = await supabase
                    .from("orders_v2")
                    .select("id, profile_id, user_id")
                    .eq("id", parsed.orderId)
                    .maybeSingle();
                  
                  if (order) {
                    const paymentData = {
                      order_id: order.id,
                      user_id: order.user_id || order.profile_id,
                      profile_id: order.profile_id,
                      amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100),
                      currency: tx.currency || "BYN",
                      status: normalizedStatus,
                      transaction_type: txType,
                      provider: "bepaid",
                      provider_payment_id: tx.uid,
                      provider_response: tx,
                      paid_at: tx.paid_at || tx.created_at,
                      card_last4: tx.credit_card?.last_4,
                      card_brand: tx.credit_card?.brand,
                      meta: {
                        transaction_type: txType,
                        source: "uid_fallback",
                        tracking_id: tx.tracking_id,
                      },
                    };
                    
                    const { error: upsertError } = await supabase
                      .from("payments_v2")
                      .upsert(paymentData, { onConflict: "provider_payment_id" });
                    
                    if (!upsertError) {
                      results.recovered = (results.recovered || 0) + 1;
                      
                      // Update queue item status
                      await supabase
                        .from("payment_reconcile_queue")
                        .update({ status: "processed" })
                        .eq("bepaid_uid", item.bepaid_uid);
                    }
                  }
                }
              }
            }
          } catch (uidErr) {
            console.error(`[bepaid-fetch] Fallback UID fetch error:`, uidErr);
          }
        }
        
        console.log(`[bepaid-fetch] Fallback recovered ${results.recovered || 0} transactions`);
      }
      
      if (!results.recovered) {
        console.error(`[bepaid-fetch] No working endpoint found and no fallback data!`);
        results.stopped_reason = "no_working_endpoint";
        
        await updateSyncLog(supabase, syncLogId, {
          status: "failed",
          error_message: "No working bePaid endpoint found. All probed endpoints failed.",
          completed_at: new Date().toISOString(),
          meta: { probe_results: probeResults, fallback_attempted: true },
        });

        // Audit log with failure reason
        await supabase.from("audit_logs").insert({
          actor_user_id: null,
          actor_type: "system",
          actor_label: "bepaid-fetch-transactions",
          action: "bepaid_fetch_transactions_cron",
          meta: {
            mode,
            syncMode: 'BULK',
            stopped_reason: "no_working_endpoint",
            probe_results: probeResults,
            fallback_attempted: true,
            duration_ms: Date.now() - startTime,
          },
        });

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Step 2: Fetch transactions from working endpoint
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= config.sync_max_pages && results.items_processed < config.sync_max_items) {
      if (Date.now() - startTime > config.sync_max_runtime_ms) {
        results.stopped_reason = "max_runtime_reached";
        break;
      }

      const fromDateISO = fromDate.toISOString();
      const toDateISO = toDate.toISOString();
      
      const params = new URLSearchParams({
        created_at_from: fromDateISO,
        created_at_to: toDateISO,
        per_page: String(config.sync_page_size),
        page: String(page),
      });

      const fetchUrl = `${workingEndpoint}?${params.toString()}`;
      console.log(`[bepaid-fetch] Fetching page ${page}: ${fetchUrl}`);

      try {
        const response = await fetch(fetchUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "X-Api-Version": "3",
          },
        });

        if (!response.ok) {
          console.error(`[bepaid-fetch] Page ${page} failed: ${response.status}`);
          results.errors++;
          break;
        }

        const data = await response.json();
        const rawTransactions = data.transactions || data.data?.transactions || [];
        
        // Unwrap if transactions are nested
        const transactions = rawTransactions.map((t: any) => t.transaction || t);
        
        results.pages_fetched++;
        results.transactions_fetched += transactions.length;

        console.log(`[bepaid-fetch] Page ${page}: got ${transactions.length} transactions`);

        if (transactions.length === 0) {
          hasMore = false;
          break;
        }

        // Collect sample UIDs
        if (results.sample_uids.length < 10) {
          results.sample_uids.push(
            ...transactions.slice(0, 10 - results.sample_uids.length).map((t: any) => t.uid)
          );
        }

        // Get existing payments in batch for deduplication
        const uids = transactions.map((t: any) => t.uid).filter(Boolean);
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
            break;
          }

          const uid = tx.uid;
          if (!uid) continue;

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

          // For dry-run mode
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

          // EXECUTE MODE
          // Process ALL transactions - with orderId AND manual invoices (without orderId)
          // This ensures failed, refunded, and other statuses are also recorded
          
          let paymentData: any = null;
          let linkedOrder: any = null;
          
          if (parsed.orderId) {
            // Check if order exists
            const { data: order } = await supabase
              .from("orders_v2")
              .select("id, profile_id, user_id")
              .eq("id", parsed.orderId)
              .maybeSingle();

            if (order) {
              linkedOrder = order;
              // Create payment record with ACTUAL status (not hardcoded "successful")
              paymentData = {
                order_id: order.id,
                user_id: order.user_id || order.profile_id,
                profile_id: order.profile_id,
                amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100),
                currency: tx.currency || "BYN",
                status: normalizedStatus,  // FIXED: Use actual status (successful, failed, refunded, etc)
                transaction_type: txType,   // payment, refund, void, etc
                provider: "bepaid",
                provider_payment_id: uid,
                provider_response: tx,
                paid_at: tx.paid_at || tx.created_at,
                card_last4: tx.credit_card?.last_4,
                card_brand: tx.credit_card?.brand,
                receipt_url: tx.receipt_url,
                meta: {
                  transaction_type: txType,
                  tracking_id: tx.tracking_id,
                  parent_uid: tx.parent_uid,
                  source: "bulk_sync",
                  original_status: tx.status,  // Store original bePaid status for reference
                },
              };
            }
          }
          
          // NEW: Save transactions WITHOUT order_id as manual invoices
          // This fixes the "Found 7, Added 0" bug for manual invoice payments
          if (!paymentData && !parsed.orderId) {
            console.log(`[bepaid-fetch] Processing manual invoice: UID=${uid}, tracking=${tx.tracking_id}, email=${tx.customer?.email}`);
            
            paymentData = {
              order_id: null,  // No linked order
              user_id: null,
              profile_id: null,
              amount: isRefund ? -(tx.amount / 100) : (tx.amount / 100),
              currency: tx.currency || "BYN",
              status: normalizedStatus,
              transaction_type: txType,
              provider: "bepaid",
              provider_payment_id: uid,
              provider_response: tx,
              paid_at: tx.paid_at || tx.created_at,
              card_last4: tx.credit_card?.last_4,
              card_brand: tx.credit_card?.brand,
              receipt_url: tx.receipt_url,
              meta: {
                transaction_type: txType,
                tracking_id: tx.tracking_id,
                parent_uid: tx.parent_uid,
                source: "manual_invoice",
                original_status: tx.status,
                customer_email: tx.customer?.email,
                customer_name: tx.customer?.first_name || tx.customer?.last_name 
                  ? `${tx.customer?.first_name || ''} ${tx.customer?.last_name || ''}`.trim()
                  : tx.credit_card?.holder,
              },
            };
            
            // Try to find profile by customer email
            if (tx.customer?.email) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("id, user_id")
                .eq("email", tx.customer.email)
                .maybeSingle();
              
              if (profile) {
                paymentData.profile_id = profile.id;
                paymentData.user_id = profile.user_id;
                console.log(`[bepaid-fetch] Manual invoice linked to profile by email: ${profile.id}`);
                results.manual_invoices_linked = (results.manual_invoices_linked || 0) + 1;
              }
            }
            
            results.manual_invoices_added = (results.manual_invoices_added || 0) + 1;
          }

          // Process refunds - link to parent payment AND inherit profile_id
          if (paymentData && isRefund) {
            let parentUid = tx.parent_uid || tx.parent_transaction_uid;
            
            // If parent_uid missing, try to fetch from bePaid API
            if (!parentUid && uid) {
              try {
                const txDetailsResp = await fetch(
                  `https://gateway.bepaid.by/transactions/${uid}`,
                  { 
                    headers: { 
                      Authorization: `Basic ${auth}`, 
                      Accept: "application/json" 
                    } 
                  }
                );
                if (txDetailsResp.ok) {
                  const txDetails = await txDetailsResp.json();
                  parentUid = txDetails.transaction?.parent_uid || txDetails.parent_uid;
                  console.log(`[bepaid-fetch] Got parent_uid from API for refund ${uid}: ${parentUid}`);
                }
              } catch (e) {
                console.error(`[bepaid-fetch] Failed to get parent_uid for ${uid}:`, e);
              }
            }
            
            let parentPayment = null;
            
            if (parentUid) {
              const { data: foundParent } = await supabase
                .from("payments_v2")
                .select("id, profile_id, user_id, order_id")
                .eq("provider_payment_id", parentUid)
                .maybeSingle();
              parentPayment = foundParent;
            }
            
            // FALLBACK: If parent not found by parent_uid, try by tracking_id
            // This links refunds to original payments with same tracking_id
            if (!parentPayment && tx.tracking_id) {
              console.log(`[bepaid-fetch] Trying to find parent by tracking_id: ${tx.tracking_id}`);
              const { data: foundByTracking } = await supabase
                .from("payments_v2")
                .select("id, profile_id, user_id, order_id, meta")
                .gt("amount", 0)  // Original payment is positive
                .order("paid_at", { ascending: false })
                .limit(10);
              
              // Find matching tracking_id in meta
              if (foundByTracking) {
                for (const p of foundByTracking) {
                  if (p.meta?.tracking_id === tx.tracking_id) {
                    parentPayment = p;
                    console.log(`[bepaid-fetch] Found parent by tracking_id: ${p.id}`);
                    break;
                  }
                }
              }
            }

            if (parentPayment) {
              paymentData.reference_payment_id = parentPayment.id;
              // INHERIT profile_id, user_id, order_id from parent
              paymentData.profile_id = parentPayment.profile_id;
              paymentData.user_id = parentPayment.user_id;
              if (!paymentData.order_id) {
                paymentData.order_id = parentPayment.order_id;
              }
              console.log(`[bepaid-fetch] Linked refund ${uid} to parent, profile: ${parentPayment.profile_id}, order: ${parentPayment.order_id}`);
              results.refunds_linked = (results.refunds_linked || 0) + 1;
            } else if (parentUid) {
              console.log(`[bepaid-fetch] Refund ${uid} parent not found in payments_v2: ${parentUid}`);
              results.missing_parent = (results.missing_parent || 0) + 1;
            } else {
              console.log(`[bepaid-fetch] Refund ${uid} has no parent_uid and no tracking_id match`);
              results.refunds_orphan = (results.refunds_orphan || 0) + 1;
            }
          }

          // Upsert payment if we have data
          if (paymentData) {
            const { error: upsertError } = await supabase
              .from("payments_v2")
              .upsert(paymentData, { 
                onConflict: "provider_payment_id",
                ignoreDuplicates: false,
              });

            if (upsertError) {
              console.error(`[bepaid-fetch] Payment upsert error for UID ${uid}:`, JSON.stringify({
                error: upsertError,
                paymentData: {
                  uid,
                  amount: paymentData.amount,
                  status: paymentData.status,
                  tracking_id: tx.tracking_id,
                  order_id: paymentData.order_id,
                  profile_id: paymentData.profile_id,
                }
              }));
              results.errors++;
              results.upsert_errors = results.upsert_errors || [];
              results.upsert_errors.push({ uid, error: upsertError.message });
            } else {
              results.upserted++;
            }
            continue;
          }

          // Queue for manual review if not already there (fallback for transactions we couldn't process)
          if (!existingQueueUids.has(uid)) {
            const queueData: any = {
              provider: "bepaid",
              bepaid_uid: uid,
              tracking_id: tx.tracking_id,
              amount: tx.amount ? tx.amount / 100 : null,
              currency: tx.currency || "BYN",
              customer_email: tx.customer?.email,
              raw_payload: tx,
              source: "bulk_sync",
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

        if (results.stopped_reason) break;

        // Check if less than page size means no more pages
        if (transactions.length < config.sync_page_size) {
          hasMore = false;
        } else {
          page++;
        }

      } catch (err) {
        console.error(`[bepaid-fetch] Page ${page} exception:`, err);
        results.errors++;
        break;
      }
    }

    if (page > config.sync_max_pages && hasMore) {
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
        syncMode,
        working_endpoint: workingEndpoint,
        payments_found: results.payments_found,
        refunds_found: results.refunds_found,
        upserted: results.upserted,
        stopped_reason: results.stopped_reason,
        duration_ms: Date.now() - startTime,
      },
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: "system",
      actor_label: "bepaid-fetch-transactions",
      action: "bepaid_fetch_transactions_cron",
      meta: {
        mode,
        syncMode: 'BULK',
        working_endpoint: workingEndpoint,
        transactions_fetched: results.transactions_fetched,
        payments_found: results.payments_found,
        refunds_found: results.refunds_found,
        already_exists: results.already_exists,
        queued_for_review: results.queued_for_review,
        upserted: results.upserted,
        errors: results.errors,
        stopped_reason: results.stopped_reason,
        duration_ms: Date.now() - startTime,
      },
    });

    // Add summary for diagnostics
    results.summary = {
      total_from_api: results.transactions_fetched,
      reports_api_used: results.reports_api_used || false,
      reports_api_count: results.reports_api_count || 0,
      reports_api_endpoint: results.reports_api_endpoint || null,
      fallback_used: results.fallback_mode || false,
      refunds_linked: results.refunds_linked || 0,
      refunds_orphan: results.refunds_orphan || 0,
      missing_parent_count: results.missing_parent || 0,
      manual_invoices_added: results.manual_invoices_added || 0,
      manual_invoices_linked: results.manual_invoices_linked || 0,
      upsert_errors_count: (results.upsert_errors || []).length,
    };

    console.log(`[bepaid-fetch] Completed in ${Date.now() - startTime}ms`);
    console.log(`[bepaid-fetch] Results:`, JSON.stringify({
      working_endpoint: workingEndpoint,
      reports_api_used: results.reports_api_used,
      transactions_fetched: results.transactions_fetched,
      refunds_found: results.refunds_found,
      refunds_linked: results.refunds_linked,
      queued_for_review: results.queued_for_review,
      upserted: results.upserted,
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
