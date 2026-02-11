import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncRequest {
  payment_ids?: string[];
  source?: 'queue' | 'payments_v2' | 'all';
  batch_size?: number;
  dry_run?: boolean;
}

interface ReceiptSyncResult {
  payment_id: string;
  source: 'queue' | 'payments_v2';
  status: 'updated' | 'unavailable' | 'error' | 'skipped';
  receipt_url?: string;
  fee_amount?: number;
  fee_currency?: string;
  error_code?: string;
  message?: string;
}

interface SyncReport {
  total_checked: number;
  updated: number;
  unavailable: number;
  errors: number;
  skipped: number;
  fees_updated: number;
  results: ReceiptSyncResult[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

    const body: SyncRequest = await req.json();
    const { 
      payment_ids, 
      source = 'all', 
      batch_size = 50,
      dry_run = false 
    } = body;

    // Hard limit for safety
    const effectiveBatchSize = Math.min(batch_size, 200);

    console.log(`[bepaid-receipts-sync] Starting sync: source=${source}, batch_size=${effectiveBatchSize}, dry_run=${dry_run}, specific_ids=${payment_ids?.length || 0}`);

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabaseAdmin);
    if (isBepaidCredsError(credsResult)) {
      return new Response(
        JSON.stringify({ success: false, message: "bePaid credentials missing: " + credsResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const bepaidCreds = credsResult;
    const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

    const report: SyncReport = {
      total_checked: 0,
      updated: 0,
      unavailable: 0,
      errors: 0,
      skipped: 0,
      fees_updated: 0,
      results: [],
    };

    const successStatuses = ['successful', 'succeeded'];

    // Helper to extract fee from bePaid response with multiple fallback paths
    const extractFee = (transaction: any): { amount: number | null; currency: string | null } => {
      if (!transaction) return { amount: null, currency: null };
      
      // Try multiple paths for fee
      const fee = transaction.fee 
        ?? transaction.processing?.fee
        ?? transaction.payment?.fee
        ?? transaction.authorization?.fee
        ?? null;
      
      if (fee !== null && fee !== undefined) {
        // bePaid returns fee in cents
        return { 
          amount: Number(fee) / 100, 
          currency: transaction.currency || 'BYN' 
        };
      }
      
      return { amount: null, currency: null };
    };

    // Helper to fetch receipt and fee from bePaid
    const fetchTransactionDetails = async (providerUid: string): Promise<{ 
      receipt_url: string | null; 
      fee_amount: number | null;
      fee_currency: string | null;
      error_code?: string 
    }> => {
      try {
        const response = await fetch(`https://gateway.bepaid.by/transactions/${providerUid}`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return { receipt_url: null, fee_amount: null, fee_currency: null, error_code: 'API_ERROR' };
        }

        const data = await response.json();
        const transaction = data.transaction;

        if (!transaction) {
          return { receipt_url: null, fee_amount: null, fee_currency: null, error_code: 'API_ERROR' };
        }

        // Extract receipt URL with multiple fallback paths
        const receiptUrl = transaction.receipt_url 
          || transaction.receipt?.url 
          || transaction.bill?.receipt_url
          || transaction.authorization?.receipt_url
          || null;

        // Extract fee
        const { amount: feeAmount, currency: feeCurrency } = extractFee(transaction);

        if (!receiptUrl && feeAmount === null) {
          return { receipt_url: null, fee_amount: null, fee_currency: null, error_code: 'PROVIDER_NO_RECEIPT' };
        }

        return { receipt_url: receiptUrl, fee_amount: feeAmount, fee_currency: feeCurrency };
      } catch (e) {
        console.error(`[bepaid-receipts-sync] Error fetching details for ${providerUid}:`, e);
        return { receipt_url: null, fee_amount: null, fee_currency: null, error_code: 'API_ERROR' };
      }
    };

    // Process queue items
    if (source === 'all' || source === 'queue') {
      let queueQuery = supabaseAdmin
        .from('payment_reconcile_queue')
        .select('id, bepaid_uid, status_normalized, receipt_url')
        .is('receipt_url', null)
        .not('bepaid_uid', 'is', null)
        .limit(effectiveBatchSize);

      // Filter by specific IDs if provided
      if (payment_ids && payment_ids.length > 0) {
        queueQuery = queueQuery.in('id', payment_ids);
      }

      const { data: queueItems, error: queueError } = await queueQuery;
      
      if (queueError) {
        console.error('[bepaid-receipts-sync] Queue query error:', queueError);
      } else if (queueItems) {
        for (const item of queueItems) {
          report.total_checked++;

          // Skip non-successful payments
          if (!successStatuses.includes((item.status_normalized || '').toLowerCase())) {
            report.skipped++;
            report.results.push({
              payment_id: item.id,
              source: 'queue',
              status: 'skipped',
              error_code: 'NOT_SUCCESSFUL',
              message: `Status: ${item.status_normalized}`,
            });
            continue;
          }

          if (!item.bepaid_uid) {
            report.skipped++;
            report.results.push({
              payment_id: item.id,
              source: 'queue',
              status: 'skipped',
              error_code: 'NO_PROVIDER_ID',
            });
            continue;
          }

          const { receipt_url, fee_amount, fee_currency, error_code } = await fetchTransactionDetails(item.bepaid_uid);

          if (receipt_url || fee_amount !== null) {
            if (!dry_run) {
              const updateData: any = {};
              if (receipt_url) updateData.receipt_url = receipt_url;
              // Queue table may not have fee columns - skip fee update for queue
              
              const { error: updateError } = await supabaseAdmin
                .from('payment_reconcile_queue')
                .update(updateData)
                .eq('id', item.id);

              if (updateError) {
                report.errors++;
                report.results.push({
                  payment_id: item.id,
                  source: 'queue',
                  status: 'error',
                  message: updateError.message,
                });
                continue;
              }
            }
            report.updated++;
            report.results.push({
              payment_id: item.id,
              source: 'queue',
              status: 'updated',
              receipt_url: receipt_url || undefined,
              fee_amount: fee_amount || undefined,
              fee_currency: fee_currency || undefined,
            });
          } else {
            report.unavailable++;
            report.results.push({
              payment_id: item.id,
              source: 'queue',
              status: 'unavailable',
              error_code,
            });
          }
        }
      }
    }

    // Process payments_v2 items - also fetch fee for items without fee info
    if (source === 'all' || source === 'payments_v2') {
      // Expand query to include items that need receipt_url or fee
      let paymentsQuery = supabaseAdmin
        .from('payments_v2')
        .select('id, provider_payment_id, status, receipt_url, provider_response')
        .not('provider_payment_id', 'is', null)
        .limit(effectiveBatchSize);

      // Filter by specific IDs if provided
      if (payment_ids && payment_ids.length > 0) {
        paymentsQuery = paymentsQuery.in('id', payment_ids);
      }

      const { data: paymentItems, error: paymentsError } = await paymentsQuery;
      
      if (paymentsError) {
        console.error('[bepaid-receipts-sync] Payments query error:', paymentsError);
      } else if (paymentItems) {
        for (const item of paymentItems) {
          report.total_checked++;

          // Skip non-successful payments
          if (!successStatuses.includes((item.status || '').toLowerCase())) {
            report.skipped++;
            report.results.push({
              payment_id: item.id,
              source: 'payments_v2',
              status: 'skipped',
              error_code: 'NOT_SUCCESSFUL',
              message: `Status: ${item.status}`,
            });
            continue;
          }

          if (!item.provider_payment_id) {
            report.skipped++;
            report.results.push({
              payment_id: item.id,
              source: 'payments_v2',
              status: 'skipped',
              error_code: 'NO_PROVIDER_ID',
            });
            continue;
          }

          const { receipt_url, fee_amount, fee_currency, error_code } = await fetchTransactionDetails(item.provider_payment_id);

          if (receipt_url || fee_amount !== null) {
            if (!dry_run) {
              const updateData: any = {};
              if (receipt_url) updateData.receipt_url = receipt_url;
              
              // Update provider_response with fee info if we got it
              if (fee_amount !== null) {
                const existingResponse = (item.provider_response as any) || {};
                updateData.provider_response = {
                  ...existingResponse,
                  transaction: {
                    ...(existingResponse.transaction || {}),
                    fee: Math.round(fee_amount * 100), // Store in cents for consistency
                  }
                };
                report.fees_updated++;
              }
              
              const { error: updateError } = await supabaseAdmin
                .from('payments_v2')
                .update(updateData)
                .eq('id', item.id);

              if (updateError) {
                report.errors++;
                report.results.push({
                  payment_id: item.id,
                  source: 'payments_v2',
                  status: 'error',
                  message: updateError.message,
                });
                continue;
              }
            }
            report.updated++;
            report.results.push({
              payment_id: item.id,
              source: 'payments_v2',
              status: 'updated',
              receipt_url: receipt_url || undefined,
              fee_amount: fee_amount || undefined,
              fee_currency: fee_currency || undefined,
            });
          } else {
            report.unavailable++;
            report.results.push({
              payment_id: item.id,
              source: 'payments_v2',
              status: 'unavailable',
              error_code,
            });
          }
        }
      }
    }

    // Write audit log
    await supabaseAdmin.from('audit_logs').insert({
      action: 'receipts_sync',
      actor_user_id: user.id,
      meta: {
        dry_run,
        source,
        batch_size: effectiveBatchSize,
        specific_ids_count: payment_ids?.length || 0,
        total_checked: report.total_checked,
        updated: report.updated,
        unavailable: report.unavailable,
        errors: report.errors,
        skipped: report.skipped,
        fees_updated: report.fees_updated,
      },
    });

    console.log(`[bepaid-receipts-sync] Complete: checked=${report.total_checked}, updated=${report.updated}, unavailable=${report.unavailable}, errors=${report.errors}, skipped=${report.skipped}, fees_updated=${report.fees_updated}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        dry_run,
        report 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[bepaid-receipts-sync] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
