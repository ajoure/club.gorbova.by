import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * UID-based Recovery for bePaid transactions
 * 
 * This function recovers/enriches payment data by fetching individual transactions
 * using known UIDs from multiple sources:
 * 
 * 1. orders_v2 (PRIMARY SOURCE) - bepaid_uid from meta for paid/refunded orders
 * 2. payment_reconcile_queue - webhook/api_recover sources
 * 3. payments_v2 - incomplete records (paid_at IS NULL or provider_response is empty)
 * 
 * Algorithm:
 * 1. Collect candidate UIDs from all sources
 * 2. Deduplicate UIDs
 * 3. Fetch each UID individually from bePaid API (batched with concurrency)
 * 4. Upsert into payments_v2 (preserving existing order_id/profile_id/user_id)
 * 5. Log results to audit_logs
 */

interface ResyncRequest {
  fromDate: string;
  toDate: string;
  dryRun?: boolean;
  limit?: number;
  unsafeAllowLarge?: boolean;
}

interface ResyncResult {
  success: boolean;
  dryRun: boolean;
  warning?: string;
  stats: {
    total_candidates: number;
    sources: {
      orders: number;
      queue_webhook: number;
      queue_api_recover: number;
      queue_file_import: number;
      queue_manual: number;
      payments_incomplete: number;
    };
    processed: number;
    updated: number;
    created: number;
    fetch_errors: number;
    already_complete: number;
    paid_at_fixed: number;
  };
  samples: {
    updated: Array<{ uid: string; paid_at_before: string | null; paid_at_after: string | null }>;
    errors: Array<{ uid: string; error: string }>;
  };
  stop_reason?: string;
}

async function fetchTransaction(uid: string, auth: string): Promise<{ success: boolean; data?: any; error?: string }> {
  // auth is already base64 string
  
  // Try multiple endpoints
  const endpoints = [
    `https://gateway.bepaid.by/transactions/${uid}`,
    `https://api.bepaid.by/transactions/${uid}`,
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          // NO Content-Type for GET requests!
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      }
      
      if (response.status === 404) {
        continue; // Try next endpoint
      }
      
      const errorText = await response.text();
      return { success: false, error: `${response.status}: ${errorText}` };
    } catch (e) {
      console.log(`[bepaid-uid-resync] Endpoint ${endpoint} failed:`, e);
      continue;
    }
  }
  
  return { success: false, error: 'All endpoints failed or returned 404' };
}

// Process a batch of UIDs with concurrency limit
async function processBatch<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(processor));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // PATCH-P0.9.1: Strict creds
  const credsResult = await getBepaidCredsStrict(supabaseAdmin);
  if (isBepaidCredsError(credsResult)) {
    return new Response(
      JSON.stringify({ success: false, message: "bePaid credentials not configured: " + credsResult.error }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const bepaidCreds = credsResult;
  const shopId = bepaidCreds.shop_id;
  const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

  console.log(`[bepaid-uid-resync] Using shopId: ${shopId}`);

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ success: false, message: "Missing authorization" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    // Verify user is admin
    const { data: { user } } = await supabaseAnon.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, message: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: ResyncRequest = await req.json();
    const { 
      fromDate,
      toDate,
      dryRun = true,
      limit = 200,  // Reduced default limit
      unsafeAllowLarge = false,
    } = body;

    console.log(`[bepaid-uid-resync] Starting UID-based recovery: from=${fromDate}, to=${toDate}, dryRun=${dryRun}, limit=${limit}`);

    const result: ResyncResult = {
      success: true,
      dryRun,
      warning: "Resync по известным UID из orders, очереди и незаполненных платежей.",
      stats: {
        total_candidates: 0,
        sources: {
          orders: 0,
          queue_webhook: 0,
          queue_api_recover: 0,
          queue_file_import: 0,
          queue_manual: 0,
          payments_incomplete: 0,
        },
        processed: 0,
        updated: 0,
        created: 0,
        fetch_errors: 0,
        already_complete: 0,
        paid_at_fixed: 0,
      },
      samples: {
        updated: [],
        errors: [],
      },
    };

    // Step 1: PRIMARY SOURCE - orders_v2 with bepaid_uid in meta
    // IMPORTANT: No status filter - process ALL orders with bepaid_uid
    const { data: ordersWithUid, error: ordersError } = await supabaseAdmin
      .from('orders_v2')
      .select('id, meta, status')
      .not('meta->bepaid_uid', 'is', null)
      .gte('created_at', `${fromDate}T00:00:00Z`)
      .lte('created_at', `${toDate}T23:59:59Z`)
      .limit(limit);

    if (ordersError) {
      console.error('[bepaid-uid-resync] Orders query error:', ordersError);
      throw new Error(`Orders query failed: ${ordersError.message}`);
    }

    // Filter orders with bepaid_uid in meta
    const ordersWithBepaidUid = (ordersWithUid || []).filter(o => {
      const meta = o.meta as Record<string, unknown> | null;
      return meta && typeof meta.bepaid_uid === 'string' && meta.bepaid_uid.length > 0;
    });
    result.stats.sources.orders = ordersWithBepaidUid.length;

    // Step 2: Collect candidate UIDs from queue (webhook, api_recover sources)
    const { data: queueItems, error: queueError } = await supabaseAdmin
      .from('payment_reconcile_queue')
      .select('bepaid_uid, source, status')
      .in('source', ['webhook', 'api_recover', 'file_import', 'manual'])
      .not('status', 'in', '("cancelled","completed")')
      .not('bepaid_uid', 'is', null)
      .gte('created_at', `${fromDate}T00:00:00Z`)
      .lte('created_at', `${toDate}T23:59:59Z`)
      .limit(limit);

    if (queueError) {
      console.error('[bepaid-uid-resync] Queue query error:', queueError);
      throw new Error(`Queue query failed: ${queueError.message}`);
    }

    // Step 3: Collect candidate UIDs from payments_v2 (incomplete data)
    const { data: incompletePayments, error: paymentsError } = await supabaseAdmin
      .from('payments_v2')
      .select('provider_payment_id, paid_at, provider_response')
      .eq('provider', 'bepaid')
      .not('provider_payment_id', 'is', null)
      .gte('created_at', `${fromDate}T00:00:00Z`)
      .lte('created_at', `${toDate}T23:59:59Z`)
      .or('paid_at.is.null,provider_response.is.null')
      .limit(limit);

    if (paymentsError) {
      console.error('[bepaid-uid-resync] Payments query error:', paymentsError);
      throw new Error(`Payments query failed: ${paymentsError.message}`);
    }

    // Count sources
    const webhookItems = (queueItems || []).filter(q => q.source === 'webhook');
    const apiRecoverItems = (queueItems || []).filter(q => q.source === 'api_recover');
    const fileImportItems = (queueItems || []).filter(q => q.source === 'file_import');
    const manualItems = (queueItems || []).filter(q => q.source === 'manual');
    
    result.stats.sources.queue_webhook = webhookItems.length;
    result.stats.sources.queue_api_recover = apiRecoverItems.length;
    result.stats.sources.queue_file_import = fileImportItems.length;
    result.stats.sources.queue_manual = manualItems.length;
    result.stats.sources.payments_incomplete = (incompletePayments || []).length;

    // Step 4: Deduplicate UIDs from all sources
    const uidSet = new Set<string>();
    
    // Primary: orders
    for (const order of ordersWithBepaidUid) {
      const meta = order.meta as Record<string, unknown>;
      const uid = meta.bepaid_uid as string;
      if (uid) uidSet.add(uid);
    }
    
    // Queue
    for (const item of queueItems || []) {
      if (item.bepaid_uid) uidSet.add(item.bepaid_uid);
    }
    
    // Incomplete payments
    for (const payment of incompletePayments || []) {
      if (payment.provider_payment_id) uidSet.add(payment.provider_payment_id);
    }

    const candidateUids = Array.from(uidSet);
    result.stats.total_candidates = candidateUids.length;

    console.log(`[bepaid-uid-resync] Found ${candidateUids.length} unique UIDs (orders: ${ordersWithBepaidUid.length}, queue: ${queueItems?.length || 0}, payments: ${incompletePayments?.length || 0})`);

    // STOP safeguard - reduced to 500
    if (candidateUids.length > 500 && !unsafeAllowLarge && !dryRun) {
      result.success = false;
      result.stop_reason = `STOP_SAFEGUARD: ${candidateUids.length} UIDs to process (>500). Сузьте даты или установите unsafeAllowLarge=true.`;
      
      await supabaseAdmin.from('audit_logs').insert({
        action: 'bepaid_uid_resync_blocked',
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid_uid_recovery',
        meta: {
          reason: 'STOP_SAFEGUARD',
          total_candidates: candidateUids.length,
          sources: result.stats.sources,
          from: fromDate,
          to: toDate,
          initiated_by: user.id,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (candidateUids.length === 0) {
      console.log('[bepaid-uid-resync] No candidates found, nothing to do');
      
      await supabaseAdmin.from('audit_logs').insert({
        action: 'bepaid_uid_resync',
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid_uid_recovery',
        meta: {
          dry_run: dryRun,
          from: fromDate,
          to: toDate,
          total_candidates: 0,
          initiated_by: user.id,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 5: Fetch each UID and upsert with batching
    const processLimit = Math.min(candidateUids.length, limit);
    const uidsToProcess = candidateUids.slice(0, processLimit);
    
    const BATCH_SIZE = 20;
    const CONCURRENCY = 5;
    
    // Process single UID
    const processUid = async (uid: string) => {
      // Check if already complete in payments_v2
      const { data: existingPayment } = await supabaseAdmin
        .from('payments_v2')
        .select('id, paid_at, provider_response, order_id, profile_id, user_id')
        .eq('provider', 'bepaid')
        .eq('provider_payment_id', uid)
        .single();

      const hasCompleteData = existingPayment?.paid_at && existingPayment?.provider_response;
      
      if (hasCompleteData) {
        result.stats.already_complete++;
        return;
      }

      // Fetch from bePaid API
      const fetchResult = await fetchTransaction(uid, auth);
      result.stats.processed++;

      if (!fetchResult.success || !fetchResult.data) {
        result.stats.fetch_errors++;
        if (result.samples.errors.length < 10) {
          result.samples.errors.push({ uid, error: fetchResult.error || 'Unknown error' });
        }
        console.log(`[bepaid-uid-resync] Fetch failed for ${uid}: ${fetchResult.error}`);
        return;
      }

      const transaction = fetchResult.data.transaction;
      if (!transaction) {
        result.stats.fetch_errors++;
        if (result.samples.errors.length < 10) {
          result.samples.errors.push({ uid, error: 'No transaction in response' });
        }
        return;
      }

      // Extract paid_at: priority transaction.paid_at -> transaction.created_at
      // NEVER use now() as fallback
      const newPaidAt = transaction.paid_at || transaction.created_at || null;
      const oldPaidAt = existingPayment?.paid_at || null;

      if (dryRun) {
        if (existingPayment) {
          result.stats.updated++;
          if (!oldPaidAt && newPaidAt) {
            result.stats.paid_at_fixed++;
          }
        } else {
          result.stats.created++;
        }
        
        if (result.samples.updated.length < 10) {
          result.samples.updated.push({
            uid,
            paid_at_before: oldPaidAt,
            paid_at_after: newPaidAt,
          });
        }
      } else {
        // Execute upsert
        // CRITICAL: Do NOT overwrite existing order_id, profile_id, user_id
        
        // Comprehensive status mapping from bePaid to payments_v2
        const mapBepaidStatus = (bepStatus: string | undefined): string => {
          const s = (bepStatus || '').toLowerCase();
          if (s === 'successful' || s === 'paid') return 'succeeded';
          if (s === 'refunded') return 'refunded';
          if (['failed', 'declined', 'error'].includes(s)) return 'failed';
          if (['expired', 'voided', 'cancelled', 'canceled'].includes(s)) return 'canceled';
          if (s === 'pending' || s === 'processing') return 'pending';
          return 'pending'; // Unknown status → pending for manual review
        };
        
        // Extract gateway error message if present
        const gatewayMessage = transaction.message 
          || transaction.gateway_message 
          || transaction.response?.message 
          || null;
        
        // Map bePaid transaction type to our transaction_type
        const mapBepaidType = (txType: string | undefined, hasRefund: boolean): string => {
          const t = (txType || '').toLowerCase();
          if (t === 'refund' || hasRefund) return 'refund';
          if (t === 'chargeback') return 'chargeback';
          if (t === 'void' || t === 'voided') return 'void';
          if (t === 'authorization' || t === 'auth') return 'authorization';
          return 'payment';
        };
        
        const hasRefundData = !!transaction.refund || 
                              !!transaction.refund_reason || 
                              transaction.type === 'refund';
        
        const upsertData: Record<string, any> = {
          provider: 'bepaid',
          provider_payment_id: uid,
          amount: transaction.amount ? Number(transaction.amount) / 100 : null,
          currency: transaction.currency || 'BYN',
          status: mapBepaidStatus(transaction.status),
          transaction_type: mapBepaidType(transaction.type, hasRefundData),
          paid_at: newPaidAt,
          provider_response: fetchResult.data,
          card_last4: transaction.credit_card?.last_4,
          card_brand: transaction.credit_card?.brand,
          updated_at: new Date().toISOString(),
          meta: {
            gateway_message: gatewayMessage,
            original_bepaid_status: transaction.status,
            original_bepaid_type: transaction.type,
            source: 'uid_resync',
          },
        };

        if (existingPayment) {
          // Update only specific fields, preserve links
          // ALSO update status and meta for failed/cancelled transactions
          const { error: updateError } = await supabaseAdmin
            .from('payments_v2')
            .update({
              status: upsertData.status,
              transaction_type: upsertData.transaction_type,
              paid_at: upsertData.paid_at || existingPayment.paid_at,
              provider_response: upsertData.provider_response,
              card_last4: upsertData.card_last4 || undefined,
              card_brand: upsertData.card_brand || undefined,
              meta: upsertData.meta,
              updated_at: upsertData.updated_at,
            })
            .eq('id', existingPayment.id);

          if (updateError) {
            console.error(`[bepaid-uid-resync] Update error for ${uid}:`, updateError);
            result.stats.fetch_errors++;
          } else {
            result.stats.updated++;
            if (!oldPaidAt && newPaidAt) {
              result.stats.paid_at_fixed++;
            }
          }
        } else {
          // Create new payment record
          upsertData.created_at = new Date().toISOString();
          // Preserve gateway_message and status info in meta
          upsertData.meta = { 
            ...upsertData.meta,
            needs_manual_link: true,
          };

          const { error: insertError } = await supabaseAdmin
            .from('payments_v2')
            .insert(upsertData);

          if (insertError) {
            console.error(`[bepaid-uid-resync] Insert error for ${uid}:`, insertError);
            result.stats.fetch_errors++;
          } else {
            result.stats.created++;
          }
        }

        if (result.samples.updated.length < 10) {
          result.samples.updated.push({
            uid,
            paid_at_before: oldPaidAt,
            paid_at_after: newPaidAt,
          });
        }
      }
    };
    
    // Process in batches with concurrency
    await processBatch(uidsToProcess, CONCURRENCY, processUid);
    
    console.log(`[bepaid-uid-resync] Batch processing complete: ${uidsToProcess.length} UIDs processed`);

    // Step 5: Write audit log
    await supabaseAdmin.from('audit_logs').insert({
      action: 'bepaid_uid_resync',
      actor_user_id: null,
      actor_type: 'system',
      actor_label: 'bepaid_uid_recovery',
      meta: {
        dry_run: dryRun,
        from: fromDate,
        to: toDate,
        total_candidates: result.stats.total_candidates,
        sources: result.stats.sources,
        processed: result.stats.processed,
        updated: result.stats.updated,
        created: result.stats.created,
        fetch_errors: result.stats.fetch_errors,
        already_complete: result.stats.already_complete,
        paid_at_fixed: result.stats.paid_at_fixed,
        initiated_by: user.id,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[bepaid-uid-resync] Complete: candidates=${result.stats.total_candidates}, processed=${result.stats.processed}, updated=${result.stats.updated}, created=${result.stats.created}, errors=${result.stats.fetch_errors}`);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[bepaid-uid-resync] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
