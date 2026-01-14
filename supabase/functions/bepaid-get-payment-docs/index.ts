import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const { order_id, force_refresh = false } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'order_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log attempt
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_docs_fetch_attempt',
      meta: { order_id, force_refresh },
    });

    // Find bePaid payment for this order
    const { data: payment, error: paymentError } = await supabase
      .from('payments_v2')
      .select('*')
      .eq('order_id', order_id)
      .eq('provider', 'bepaid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'No bePaid payment found for this order',
          order_id,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!payment.provider_payment_id) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'Payment has no bePaid transaction UID (provider_payment_id)',
          order_id,
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

    // Get bePaid credentials
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    const shopId = bepaidInstance?.config?.shop_id || Deno.env.get('BEPAID_SHOP_ID');
    const secretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');

    if (!shopId || !secretKey) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'bePaid credentials not configured',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch transaction from bePaid API
    const authString = btoa(`${shopId}:${secretKey}`);
    const apiUrl = `https://gateway.bepaid.by/transactions/${payment.provider_payment_id}`;
    
    console.log(`Fetching bePaid transaction: ${payment.provider_payment_id}`);
    
    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('bePaid API error:', apiResponse.status, errorText);
      
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'bepaid_docs_fetch_failed',
        meta: { 
          order_id, 
          payment_id: payment.id,
          provider_payment_id: payment.provider_payment_id,
          error: `API ${apiResponse.status}: ${errorText.substring(0, 200)}`,
        },
      });

      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: `bePaid API error: ${apiResponse.status}`,
          provider_payment_id: payment.provider_payment_id,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Update payment record
    const updateData: Record<string, any> = {
      provider_response: txData,
    };
    
    if (receiptUrl) {
      updateData.receipt_url = receiptUrl;
    }
    
    if (newRefunds.length > 0 || allRefunds.length > 0) {
      updateData.refunds = allRefunds;
      updateData.refunded_amount = totalRefunded;
      if (lastRefundAt) {
        updateData.refunded_at = new Date(lastRefundAt).toISOString();
      }
    }

    await supabase
      .from('payments_v2')
      .update(updateData)
      .eq('id', payment.id);

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
