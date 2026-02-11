import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-process-refunds
 * 
 * Обрабатывает refunds из очереди payment_reconcile_queue
 * и создаёт записи в payments_v2 с отрицательной суммой.
 * 
 * Стратегии линковки с оригинальным платежом:
 * 1. По reference_transaction_uid / parent_uid из bePaid
 * 2. Через API bePaid - получение parent_uid для refund транзакции
 * 3. По email + сумме + близости по времени (fuzzy match)
 * 
 * Режимы:
 * - dry-run: показывает что будет сделано
 * - execute: выполняет действия
 */

interface RefundLinkResult {
  linked: boolean;
  linkedBy: string | null;
  parentPaymentId: string | null;
  parentOrderId: string | null;
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

  const body = await req.json().catch(() => ({}));
  const mode = body.mode || 'execute'; // 'dry-run' | 'execute'
  const maxItems = body.maxItems || 50;
  const fetchParentFromApi = body.fetchParentFromApi !== false; // default true

  console.log(`[process-refunds] Starting. Mode: ${mode}, maxItems: ${maxItems}`);

  // PATCH-P0.9.1: Strict creds
  const credsResult = await getBepaidCredsStrict(supabase);
  const auth = isBepaidCredsError(credsResult) ? null : createBepaidAuthHeader(credsResult).replace('Basic ', '');
  
  if (isBepaidCredsError(credsResult)) {
    console.error('[process-refunds] Missing bePaid credentials:', credsResult.error);
    // Don't fail immediately if not fetching from API, but log error
    if (fetchParentFromApi) {
        return new Response(
            JSON.stringify({ error: credsResult.error, code: 'BEPAID_CREDS_MISSING' }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  }

  const results = {
    mode,
    processed: 0,
    created_payments: 0,
    linked_to_parent: 0,
    needs_manual_link: 0,
    already_exists: 0,
    errors: 0,
    dry_run_items: [] as any[],
  };

  try {
    // Get ALL items from queue (not just refunds) - including failed/cancelled
    // This ensures full transaction transparency - every attempt is recorded
    const { data: refundItems, error: fetchError } = await supabase
      .from("payment_reconcile_queue")
      .select("*")
      .in("status", ["pending", "error", "cancelled", "failed"])
      .order("created_at", { ascending: true })
      .limit(maxItems);

    if (fetchError) {
      throw new Error(`Failed to fetch refunds: ${fetchError.message}`);
    }

    if (!refundItems || refundItems.length === 0) {
      console.log(`[process-refunds] No refunds to process`);
      return new Response(
        JSON.stringify({ ...results, message: "No refunds to process" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-refunds] Found ${refundItems.length} refunds to process`);

    // Get existing payments to avoid duplicates
    const bepaidUids = refundItems.map(r => r.bepaid_uid).filter(Boolean);
    const { data: existingPayments } = await supabase
      .from("payments_v2")
      .select("provider_payment_id")
      .in("provider_payment_id", bepaidUids);

    const existingUids = new Set((existingPayments || []).map(p => p.provider_payment_id));

    for (const item of refundItems) {
      results.processed++;

      // Check if already exists
      if (existingUids.has(item.bepaid_uid)) {
        results.already_exists++;
        
        // Mark as completed in queue
        if (mode === 'execute') {
          await supabase
            .from("payment_reconcile_queue")
            .update({ status: "completed", processed_at: new Date().toISOString() })
            .eq("id", item.id);
        }
        continue;
      }

      // Try to find parent payment
      const linkResult = await findParentPayment(
        supabase, 
        item, 
        auth, 
        fetchParentFromApi
      );

      const refundData: any = {
        uid: item.bepaid_uid,
        amount: item.amount,
        email: item.customer_email,
        linked: linkResult.linked,
        linkedBy: linkResult.linkedBy,
        parentPaymentId: linkResult.parentPaymentId,
        parentOrderId: linkResult.parentOrderId,
      };

      if (mode === 'dry-run') {
        results.dry_run_items.push(refundData);
        if (linkResult.linked) {
          results.linked_to_parent++;
        } else {
          results.needs_manual_link++;
        }
        continue;
      }

      // EXECUTE: Create payment record
      // Comprehensive status mapping from bePaid/queue to payments_v2
      const mapStatusForPayment = (queueStatus: string | undefined, txType: string | undefined): string => {
        const s = (queueStatus || '').toLowerCase();
        const t = (txType || '').toLowerCase();
        
        // If it's a refund transaction
        if (t.includes('refund') || t.includes('возврат')) return 'refunded';
        
        // Map based on status
        if (s === 'successful' || s === 'succeeded') return 'succeeded';
        if (s === 'refunded') return 'refunded';
        if (['failed', 'declined', 'error'].includes(s)) return 'failed';
        if (['expired', 'voided', 'cancelled', 'canceled'].includes(s)) return 'canceled';
        if (s === 'pending' || s === 'processing') return 'pending';
        return 'pending'; // Unknown → pending for manual review
      };
      
      const isRefundTx = (item.transaction_type || '').toLowerCase().includes('refund') 
        || (item.transaction_type || '').toLowerCase().includes('возврат');
      
      // FIXED: Use 'refunded' status for refunds, proper status for other transactions
      const paymentStatus = mapStatusForPayment(item.status_normalized || item.status, item.transaction_type);
      
      const paymentInsert: any = {
        amount: isRefundTx ? -(item.amount || 0) : (item.amount || 0), // Negative only for refunds
        currency: item.currency || "BYN",
        status: paymentStatus,
        provider: "bepaid",
        provider_payment_id: item.bepaid_uid,
        provider_response: item.raw_payload,
        paid_at: item.paid_at || item.created_at_bepaid || new Date().toISOString(),
        card_last4: item.card_last4,
        card_brand: item.card_brand,
        meta: {
          transaction_type: item.transaction_type || 'unknown',
          source: "queue_processing",
          queue_item_id: item.id,
          reference_transaction_uid: item.reference_transaction_uid,
          gateway_message: item.raw_payload?.transaction?.message || item.raw_payload?.message || null,
          original_queue_status: item.status,
        },
      };

      // If linked to parent, copy profile/order info
      if (linkResult.linked && linkResult.parentPaymentId) {
        const { data: parentPayment } = await supabase
          .from("payments_v2")
          .select("order_id, profile_id, user_id")
          .eq("id", linkResult.parentPaymentId)
          .single();

        if (parentPayment) {
          paymentInsert.order_id = parentPayment.order_id;
          paymentInsert.profile_id = parentPayment.profile_id;
          paymentInsert.user_id = parentPayment.user_id;
          paymentInsert.reference_payment_id = linkResult.parentPaymentId;
        }

        results.linked_to_parent++;
      } else {
        results.needs_manual_link++;
        paymentInsert.meta.needs_manual_link = true;
      }

      // Insert payment
      const { error: insertError } = await supabase
        .from("payments_v2")
        .insert(paymentInsert);

      if (insertError) {
        console.error(`[process-refunds] Insert error for ${item.bepaid_uid}:`, insertError);
        results.errors++;

        // Update queue item status
        await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "error", 
            last_error: insertError.message,
            attempts: (item.attempts || 0) + 1,
          })
          .eq("id", item.id);
      } else {
        results.created_payments++;

        // Mark queue item as completed
        await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "completed", 
            processed_at: new Date().toISOString() 
          })
          .eq("id", item.id);
      }
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: "system",
      actor_label: "bepaid-process-refunds",
      action: "bepaid_process_refunds",
      meta: {
        mode,
        processed: results.processed,
        created_payments: results.created_payments,
        linked_to_parent: results.linked_to_parent,
        needs_manual_link: results.needs_manual_link,
        already_exists: results.already_exists,
        errors: results.errors,
        duration_ms: Date.now() - startTime,
      },
    });

    console.log(`[process-refunds] Completed in ${Date.now() - startTime}ms`);
    console.log(`[process-refunds] Results:`, JSON.stringify(results));

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[process-refunds] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: String(error), mode }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function findParentPayment(
  supabase: any,
  item: any,
  auth: string | null,
  fetchFromApi: boolean
): Promise<RefundLinkResult> {
  const result: RefundLinkResult = {
    linked: false,
    linkedBy: null,
    parentPaymentId: null,
    parentOrderId: null,
  };

  // Method 1: reference_transaction_uid from queue/payload
  let parentUid = item.reference_transaction_uid ||
                  item.raw_payload?.parent_uid ||
                  item.raw_payload?.transaction?.parent_uid;

  // Method 2: Fetch from bePaid API if no parent_uid
  if (!parentUid && fetchFromApi && auth && item.bepaid_uid) {
    try {
      console.log(`[process-refunds] Fetching parent_uid from API for ${item.bepaid_uid}`);
      
      const response = await fetch(
        `https://gateway.bepaid.by/transactions/${item.bepaid_uid}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const tx = data.transaction || data;
        parentUid = tx.parent_uid || tx.parent_transaction_uid;
        
        if (parentUid) {
          console.log(`[process-refunds] Got parent_uid from API: ${parentUid}`);
        }
      }
    } catch (err) {
      console.error(`[process-refunds] API error:`, err);
    }
  }

  // Try to find parent payment by UID
  if (parentUid) {
    const { data: parentPayment } = await supabase
      .from("payments_v2")
      .select("id, order_id")
      .eq("provider_payment_id", parentUid)
      .maybeSingle();

    if (parentPayment) {
      result.linked = true;
      result.linkedBy = "parent_uid";
      result.parentPaymentId = parentPayment.id;
      result.parentOrderId = parentPayment.order_id;
      return result;
    }
  }

  // FUZZY MATCH DISABLED - Too risky for financial data
  // If parent_uid not found, mark as needs_manual_link
  // This prevents incorrect refund linking to wrong payments
  // 
  // Previous fuzzy logic removed per PATCH requirements:
  // - No matching by email + amount + time proximity
  // - Only exact parent_uid matching is allowed

  console.log(`[process-refunds] No parent_uid found for ${item.bepaid_uid}, marking for manual link`);
  result.linked = false;
  result.linkedBy = null;
  
  return result;
}
