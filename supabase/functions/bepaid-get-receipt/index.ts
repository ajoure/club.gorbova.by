import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GetReceiptRequest {
  payment_id: string;
  source: 'queue' | 'payments_v2';
  dry_run?: boolean;
}

interface ReceiptResult {
  status: 'available' | 'pending' | 'unavailable' | 'error';
  receipt_url?: string;
  error_code?: string;
  message?: string;
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
      JSON.stringify({ status: 'error', message: "Missing authorization" } as ReceiptResult),
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
        JSON.stringify({ status: 'error', message: "Unauthorized" } as ReceiptResult),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ status: 'error', message: "Admin access required" } as ReceiptResult),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: GetReceiptRequest = await req.json();
    const { payment_id, source, dry_run = false } = body;

    if (!payment_id) {
      return new Response(
        JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: "payment_id required" } as ReceiptResult),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bepaid-get-receipt] Fetching receipt: payment_id=${payment_id} source=${source}`);

    // Get payment record to find provider UID
    let providerUid: string | null = null;
    let statusNormalized: string = '';
    let existingReceiptUrl: string | null = null;

    if (source === 'queue') {
      const { data: queueItem, error } = await supabaseAdmin
        .from('payment_reconcile_queue')
        .select('bepaid_uid, status_normalized, receipt_url')
        .eq('id', payment_id)
        .single();
      
      if (error || !queueItem) {
        return new Response(
          JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: "Payment not found in queue" } as ReceiptResult),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      providerUid = queueItem.bepaid_uid;
      statusNormalized = queueItem.status_normalized || '';
      existingReceiptUrl = queueItem.receipt_url;
    } else {
      const { data: payment, error } = await supabaseAdmin
        .from('payments_v2')
        .select('provider_payment_id, status, receipt_url')
        .eq('id', payment_id)
        .single();
      
      if (error || !payment) {
        return new Response(
          JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: "Payment not found in payments_v2" } as ReceiptResult),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      providerUid = payment.provider_payment_id;
      statusNormalized = payment.status || '';
      existingReceiptUrl = payment.receipt_url;
    }

    // If receipt already exists, return it
    if (existingReceiptUrl) {
      return new Response(
        JSON.stringify({ status: 'available', receipt_url: existingReceiptUrl } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STOP: No provider UID
    if (!providerUid) {
      return new Response(
        JSON.stringify({ status: 'unavailable', error_code: 'NO_PROVIDER_ID', message: "No provider UID" } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STOP: Payment not successful
    const successStatuses = ['successful', 'succeeded'];
    if (!successStatuses.includes(statusNormalized.toLowerCase())) {
      return new Response(
        JSON.stringify({ status: 'unavailable', error_code: 'NOT_SUCCESSFUL', message: `Payment status: ${statusNormalized}` } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get bePaid credentials
    const { data: bepaidInstance } = await supabaseAdmin
      .from("integration_instances")
      .select("config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      return new Response(
        JSON.stringify({ status: 'error', error_code: 'API_ERROR', message: "No bePaid integration found" } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopId = (bepaidInstance.config as any).shop_id;
    const secretKey = (bepaidInstance.config as any).secret_key || Deno.env.get("BEPAID_SECRET_KEY");
    const auth = btoa(`${shopId}:${secretKey}`);

    // Fetch transaction from bePaid to get receipt URL
    console.log(`[bepaid-get-receipt] Fetching transaction ${providerUid} from bePaid`);
    
    const response = await fetch(`https://gateway.bepaid.by/transactions/${providerUid}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[bepaid-get-receipt] bePaid API error: ${response.status}`);
      return new Response(
        JSON.stringify({ status: 'error', error_code: 'API_ERROR', message: `bePaid API error: ${response.status}` } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const transaction = data.transaction;

    if (!transaction) {
      return new Response(
        JSON.stringify({ status: 'error', error_code: 'API_ERROR', message: "Transaction not found in bePaid response" } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look for receipt URL in various places
    const receiptUrl = transaction.receipt_url 
      || transaction.receipt?.url 
      || transaction.bill?.receipt_url
      || transaction.authorization?.receipt_url
      || null;

    if (!receiptUrl) {
      // No receipt available from provider
      console.log(`[bepaid-get-receipt] No receipt URL in transaction ${providerUid}`);
      return new Response(
        JSON.stringify({ status: 'unavailable', error_code: 'PROVIDER_NO_RECEIPT', message: "Receipt not available from provider" } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dry run: just return what would be saved
    if (dry_run) {
      return new Response(
        JSON.stringify({ 
          status: 'available', 
          receipt_url: receiptUrl,
          message: '[DRY-RUN] Would save receipt URL'
        } as ReceiptResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save receipt URL to database
    if (source === 'queue') {
      const { error: updateError } = await supabaseAdmin
        .from('payment_reconcile_queue')
        .update({ receipt_url: receiptUrl })
        .eq('id', payment_id);
      
      if (updateError) {
        console.error(`[bepaid-get-receipt] Failed to update queue: ${updateError.message}`);
        return new Response(
          JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: `Failed to save: ${updateError.message}` } as ReceiptResult),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('payments_v2')
        .update({ receipt_url: receiptUrl })
        .eq('id', payment_id);
      
      if (updateError) {
        console.error(`[bepaid-get-receipt] Failed to update payments_v2: ${updateError.message}`);
        return new Response(
          JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: `Failed to save: ${updateError.message}` } as ReceiptResult),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`[bepaid-get-receipt] Saved receipt URL for ${payment_id}`);

    return new Response(
      JSON.stringify({ status: 'available', receipt_url: receiptUrl } as ReceiptResult),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[bepaid-get-receipt] Error:', error);
    return new Response(
      JSON.stringify({ status: 'error', error_code: 'UNKNOWN', message: String(error) } as ReceiptResult),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
