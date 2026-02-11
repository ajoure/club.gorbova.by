import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RecoverPaymentRequest {
  uid?: string;
  tracking_id?: string;
  dry_run?: boolean;
}

interface RecoverResult {
  success: boolean;
  action: 'created' | 'updated' | 'already_exists' | 'not_found' | 'error';
  uid: string | null;
  message: string;
  details?: any;
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
      JSON.stringify({ success: false, action: 'error', uid: null, message: "Missing authorization" }),
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
        JSON.stringify({ success: false, action: 'error', uid: null, message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, action: 'error', uid: null, message: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RecoverPaymentRequest = await req.json();
    const { uid, tracking_id, dry_run = true } = body;

    if (!uid && !tracking_id) {
      return new Response(
        JSON.stringify({ success: false, action: 'error', uid: null, message: "uid or tracking_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bepaid-recover] Recovering payment: uid=${uid} tracking_id=${tracking_id} dry_run=${dry_run}`);

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabaseAdmin);
    if (isBepaidCredsError(credsResult)) {
      return new Response(
        JSON.stringify({ success: false, action: 'error', uid: null, message: "bePaid credentials missing: " + credsResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const bepaidCreds = credsResult;
    const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

    // Fetch transaction from bePaid
    let transaction: any = null;
    
    if (uid) {
      // Fetch by UID
      const response = await fetch(`https://gateway.bepaid.by/transactions/${uid}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        transaction = data.transaction;
      }
    }

    if (!transaction && tracking_id) {
      // Search by tracking_id
      const response = await fetch(`https://gateway.bepaid.by/transactions?tracking_id=${encodeURIComponent(tracking_id)}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.transactions?.length > 0) {
          transaction = data.transactions[0];
        }
      }
    }

    if (!transaction) {
      return new Response(
        JSON.stringify({
          success: false,
          action: 'not_found',
          uid,
          message: `Транзакция не найдена в bePaid: uid=${uid} tracking_id=${tracking_id}`,
        } as RecoverResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const txUid = transaction.uid;
    console.log(`[bepaid-recover] Found transaction: uid=${txUid} status=${transaction.status} amount=${transaction.amount}`);

    // Check if already exists in queue or payments_v2
    const [queueCheck, paymentsCheck] = await Promise.all([
      supabaseAdmin.from('payment_reconcile_queue').select('id').eq('bepaid_uid', txUid).single(),
      supabaseAdmin.from('payments_v2').select('id').eq('provider_payment_id', txUid).single(),
    ]);

    if (queueCheck.data || paymentsCheck.data) {
      return new Response(
        JSON.stringify({
          success: true,
          action: 'already_exists',
          uid: txUid,
          message: `Транзакция уже существует в системе`,
          details: {
            in_queue: !!queueCheck.data,
            in_payments: !!paymentsCheck.data,
            queue_id: queueCheck.data?.id,
            payment_id: paymentsCheck.data?.id,
          },
        } as RecoverResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare queue record - use raw_payload for the full transaction data
    const queueRecord = {
      bepaid_uid: txUid,
      tracking_id: transaction.tracking_id,
      amount: (transaction.amount || 0) / 100,
      currency: transaction.currency || 'BYN',
      status: transaction.status,
      status_normalized: mapStatus(transaction.status),
      transaction_type: transaction.type || 'payment',
      customer_email: transaction.customer?.email,
      customer_phone: transaction.customer?.phone,
      customer_name: transaction.customer?.first_name,
      customer_surname: transaction.customer?.last_name,
      card_holder: transaction.credit_card?.holder,
      card_last4: transaction.credit_card?.last_4,
      card_brand: transaction.credit_card?.brand,
      description: transaction.description,
      product_name: transaction.description,
      paid_at: transaction.paid_at || transaction.created_at,
      created_at_bepaid: transaction.created_at,
      source: 'api_recover',
      provider: 'bepaid',
      is_fee: false,
      is_external: false,
      has_conflict: false,
      raw_payload: transaction,
    };

    if (dry_run) {
      return new Response(
        JSON.stringify({
          success: true,
          action: 'created',
          uid: txUid,
          message: `[DRY-RUN] Транзакция будет добавлена в очередь`,
          details: {
            dry_run: true,
            record: queueRecord,
            transaction_from_bepaid: {
              uid: txUid,
              status: transaction.status,
              amount: transaction.amount / 100,
              currency: transaction.currency,
              customer_email: transaction.customer?.email,
              card_holder: transaction.credit_card?.holder,
              card_last4: transaction.credit_card?.last_4,
              paid_at: transaction.paid_at,
            },
          },
        } as RecoverResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Actually insert
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('payment_reconcile_queue')
      .insert(queueRecord)
      .select('id')
      .single();

    if (insertError) {
      console.error('[bepaid-recover] Insert error:', insertError);
      return new Response(
        JSON.stringify({
          success: false,
          action: 'error',
          uid: txUid,
          message: `Ошибка при добавлении: ${insertError.message}`,
        } as RecoverResult),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      action: 'bepaid_recover_payment',
      actor_user_id: user.id,
      meta: {
        uid: txUid,
        tracking_id,
        queue_id: inserted.id,
        amount: queueRecord.amount,
        currency: queueRecord.currency,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        action: 'created',
        uid: txUid,
        message: `Транзакция добавлена в очередь`,
        details: {
          queue_id: inserted.id,
          amount: queueRecord.amount,
          currency: queueRecord.currency,
          status: queueRecord.status_normalized,
        },
      } as RecoverResult),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[bepaid-recover] Error:', error);
    return new Response(
      JSON.stringify({ success: false, action: 'error', uid: null, message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function mapStatus(bepaidStatus: string): string {
  const map: Record<string, string> = {
    successful: 'successful',
    authorized: 'pending',
    expired: 'failed',
    failed: 'failed',
    voided: 'failed',
    canceled: 'failed',
    refunded: 'refunded',
  };
  return map[bepaidStatus] || 'pending';
}
