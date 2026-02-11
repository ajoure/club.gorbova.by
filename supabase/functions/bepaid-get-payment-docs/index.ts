import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefundItem {
  refund_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  receipt_url: string | null;
  reason: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin role
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const userRoles = roles?.map(r => r.role) || [];
    const isAdmin = userRoles.some(r => ['super_admin', 'admin', 'accountant'].includes(r));

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { order_id, payment_uid, payment_id, force_refresh = false } = body;

    // FIX: Support payment_uid/payment_id directly (no order_id required)
    if (!order_id && !payment_uid && !payment_id) {
      return new Response(
        JSON.stringify({ error: 'order_id, payment_uid or payment_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log attempt
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_docs_fetch_attempt',
      meta: { order_id, payment_uid, payment_id, force_refresh },
    });

    // Find bePaid payment - support multiple lookup methods
    let payment: any = null;
    let paymentError: any = null;

    if (payment_id) {
      // Direct lookup by payment ID
      const result = await supabase
        .from('payments_v2')
        .select('*')
        .eq('id', payment_id)
        .eq('provider', 'bepaid')
        .maybeSingle();
      payment = result.data;
      paymentError = result.error;
    } else if (payment_uid) {
      // Lookup by provider_payment_id (UID)
      const result = await supabase
        .from('payments_v2')
        .select('*')
        .eq('provider_payment_id', payment_uid)
        .eq('provider', 'bepaid')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = result.data;
      paymentError = result.error;
      
      // If not found in payments_v2, try queue
      if (!payment && !paymentError) {
        const queueResult = await supabase
          .from('payment_reconcile_queue')
          .select('id, bepaid_uid, receipt_url')
          .eq('bepaid_uid', payment_uid)
          .maybeSingle();
        
        if (queueResult.data) {
          // Create a minimal payment-like object for queue items
          payment = {
            id: queueResult.data.id,
            provider_payment_id: queueResult.data.bepaid_uid,
            receipt_url: queueResult.data.receipt_url,
            _source: 'queue',
          };
        }
      }
    } else if (order_id) {
      // Original lookup by order_id
      const result = await supabase
        .from('payments_v2')
        .select('*')
        .eq('order_id', order_id)
        .eq('provider', 'bepaid')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = result.data;
      paymentError = result.error;
    }

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'No bePaid payment found',
          order_id,
          payment_uid,
          payment_id,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const providerPaymentId = payment.provider_payment_id;
    if (!providerPaymentId) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'Payment has no bePaid transaction UID (provider_payment_id)',
          payment_id: payment.id,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If not forcing refresh and data already exists, return cached
    if (!force_refresh && payment.receipt_url) {
      const existingRefunds = (payment.refunds || []) as RefundItem[];
      return new Response(
        JSON.stringify({
          status: 'skipped',
          message: 'Data already exists, use force_refresh=true to update',
          receipt_url: payment.receipt_url,
          refunds: existingRefunds,
          refunded_amount: Number(payment.refunded_amount) || 0,
          provider_payment_id: payment.provider_payment_id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'bePaid credentials not configured: ' + credsResult.error,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const bepaidCreds = credsResult;
    
    // Fetch transaction from bePaid API - try multiple endpoints
    const authString = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');
    const endpoints = [
      `https://gateway.bepaid.by/transactions/${payment.provider_payment_id}`,
      `https://api.bepaid.by/transactions/${payment.provider_payment_id}`,
    ];
    
    console.log(`Fetching bePaid transaction: ${payment.provider_payment_id}`);
    
    let apiResponse: Response | null = null;
    let workingEndpoint = '';
    
    for (const url of endpoints) {
      console.log(`Trying endpoint: ${url}`);
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Accept': 'application/json',
        },
      });
      
      if (resp.ok) {
        apiResponse = resp;
        workingEndpoint = url;
        break;
      } else {
        const errText = await resp.text();
        console.warn(`Endpoint ${url} failed: ${resp.status} ${errText.substring(0, 100)}`);
      }
    }

    if (!apiResponse) {
      console.error('bePaid API: All endpoints failed for transaction:', payment.provider_payment_id);
      
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'bepaid_docs_fetch_failed',
        meta: { 
          order_id, 
          payment_id: payment.id,
          provider_payment_id: payment.provider_payment_id,
          error: 'All bePaid API endpoints returned 404 - transaction may not exist or is still processing',
        },
      });

      // Return graceful response instead of error - transaction may still be processing
      return new Response(
        JSON.stringify({ 
          status: 'pending', 
          message: 'Transaction not yet available in bePaid API. It may still be processing.',
          provider_payment_id: payment.provider_payment_id,
          receipt_url: payment.receipt_url || null,
          refunds: payment.refunds || [],
          refunded_amount: Number(payment.refunded_amount) || 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Working endpoint: ${workingEndpoint}`);

    const txData = await apiResponse.json();
    console.log('bePaid transaction response:', JSON.stringify(txData, null, 2));

    // Extract receipt URL from various possible locations
    const transaction = txData.transaction || txData;
    const receiptUrl = transaction.receipt_url || 
                       transaction.receipt?.url ||
                       transaction.links?.receipt ||
                       null;

    // Extract refunds from transaction data
    const existingRefunds = (payment.refunds || []) as RefundItem[];
    const newRefunds: RefundItem[] = [];
    
    // Check for refund operations in transaction
    const refundOperations = transaction.refunds || 
                            transaction.child_transactions?.filter((t: any) => t.type === 'refund') ||
                            [];
    
    for (const refund of refundOperations) {
      const refundId = refund.uid || refund.id;
      
      // Idempotency check
      if (existingRefunds.find(r => r.refund_id === refundId)) {
        continue;
      }
      
      newRefunds.push({
        refund_id: refundId,
        amount: (refund.amount || 0) / 100,
        currency: refund.currency || 'BYN',
        status: refund.status === 'successful' ? 'succeeded' : refund.status,
        created_at: refund.created_at || new Date().toISOString(),
        receipt_url: refund.receipt_url || null,
        reason: refund.message || refund.reason || null,
      });
    }

    const allRefunds = [...existingRefunds, ...newRefunds];
    const totalRefunded = allRefunds
      .filter(r => r.status === 'succeeded')
      .reduce((sum, r) => sum + r.amount, 0);
    
    const lastRefundAt = allRefunds
      .filter(r => r.status === 'succeeded')
      .map(r => new Date(r.created_at).getTime())
      .sort((a, b) => b - a)[0];

    // Update payment record - handle both payments_v2 and queue items
    const isQueueItem = payment._source === 'queue';
    const updateData: Record<string, any> = {};
    
    if (!isQueueItem) {
      updateData.provider_response = txData;
    }
    
    if (receiptUrl) {
      updateData.receipt_url = receiptUrl;
    }
    
    if (!isQueueItem && (newRefunds.length > 0 || allRefunds.length > 0)) {
      updateData.refunds = allRefunds;
      updateData.refunded_amount = totalRefunded;
      if (lastRefundAt) {
        updateData.refunded_at = new Date(lastRefundAt).toISOString();
      }
    }

    // Only update if there's something to update
    if (Object.keys(updateData).length > 0) {
      if (isQueueItem) {
        await supabase
          .from('payment_reconcile_queue')
          .update(updateData)
          .eq('id', payment.id);
      } else {
        await supabase
          .from('payments_v2')
          .update(updateData)
          .eq('id', payment.id);
      }
    }

    // Log success
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_docs_fetch_success',
      meta: { 
        order_id, 
        payment_id: payment.id,
        provider_payment_id: payment.provider_payment_id,
        receipt_found: !!receiptUrl,
        new_refunds_count: newRefunds.length,
        total_refunded: totalRefunded,
      },
    });

    return new Response(
      JSON.stringify({
        status: 'success',
        receipt_url: receiptUrl,
        refunds: allRefunds,
        refunded_amount: totalRefunded,
        provider_payment_id: payment.provider_payment_id,
        new_refunds_found: newRefunds.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('bepaid-get-payment-docs error:', error);
    return new Response(
      JSON.stringify({ status: 'failed', error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
