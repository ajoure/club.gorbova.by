import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  error_code?: string;
  message?: string;
}

interface SyncReport {
  total_checked: number;
  updated: number;
  unavailable: number;
  errors: number;
  skipped: number;
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

    console.log(`[bepaid-receipts-sync] Starting sync: source=${source}, batch_size=${batch_size}, dry_run=${dry_run}, specific_ids=${payment_ids?.length || 0}`);

    // Get bePaid credentials
    const { data: bepaidInstance } = await supabaseAdmin
      .from("integration_instances")
      .select("config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      return new Response(
        JSON.stringify({ success: false, message: "No bePaid integration found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopId = (bepaidInstance.config as any).shop_id;
    const secretKey = (bepaidInstance.config as any).secret_key || Deno.env.get("BEPAID_SECRET_KEY");
    const auth = btoa(`${shopId}:${secretKey}`);

    const report: SyncReport = {
      total_checked: 0,
      updated: 0,
      unavailable: 0,
      errors: 0,
      skipped: 0,
      results: [],
    };

    const successStatuses = ['successful', 'succeeded'];

    // Helper to fetch receipt from bePaid
    const fetchReceipt = async (providerUid: string): Promise<{ receipt_url: string | null; error_code?: string }> => {
      try {
        const response = await fetch(`https://gateway.bepaid.by/transactions/${providerUid}`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return { receipt_url: null, error_code: 'API_ERROR' };
        }

        const data = await response.json();
        const transaction = data.transaction;

        if (!transaction) {
          return { receipt_url: null, error_code: 'API_ERROR' };
        }

        const receiptUrl = transaction.receipt_url 
          || transaction.receipt?.url 
          || transaction.bill?.receipt_url
          || transaction.authorization?.receipt_url
          || null;

        if (!receiptUrl) {
          return { receipt_url: null, error_code: 'PROVIDER_NO_RECEIPT' };
        }

        return { receipt_url: receiptUrl };
      } catch (e) {
        console.error(`[bepaid-receipts-sync] Error fetching receipt for ${providerUid}:`, e);
        return { receipt_url: null, error_code: 'API_ERROR' };
      }
    };

    // Process queue items
    if (source === 'all' || source === 'queue') {
      let queueQuery = supabaseAdmin
        .from('payment_reconcile_queue')
        .select('id, bepaid_uid, status_normalized, receipt_url')
        .is('receipt_url', null)
        .not('bepaid_uid', 'is', null)
        .limit(batch_size);

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

          const { receipt_url, error_code } = await fetchReceipt(item.bepaid_uid);

          if (receipt_url) {
            if (!dry_run) {
              const { error: updateError } = await supabaseAdmin
                .from('payment_reconcile_queue')
                .update({ receipt_url })
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
              receipt_url,
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

    // Process payments_v2 items
    if (source === 'all' || source === 'payments_v2') {
      let paymentsQuery = supabaseAdmin
        .from('payments_v2')
        .select('id, provider_payment_id, status, receipt_url')
        .is('receipt_url', null)
        .not('provider_payment_id', 'is', null)
        .limit(batch_size);

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

          const { receipt_url, error_code } = await fetchReceipt(item.provider_payment_id);

          if (receipt_url) {
            if (!dry_run) {
              const { error: updateError } = await supabaseAdmin
                .from('payments_v2')
                .update({ receipt_url })
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
              receipt_url,
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
        batch_size,
        specific_ids_count: payment_ids?.length || 0,
        total_checked: report.total_checked,
        updated: report.updated,
        unavailable: report.unavailable,
        errors: report.errors,
        skipped: report.skipped,
      },
    });

    console.log(`[bepaid-receipts-sync] Complete: checked=${report.total_checked}, updated=${report.updated}, unavailable=${report.unavailable}, errors=${report.errors}, skipped=${report.skipped}`);

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
