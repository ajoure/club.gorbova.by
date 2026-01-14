import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RecomputeResult {
  order_id: string;
  payment_id: string | null;
  payment_amount: number;
  refunded_amount: number;
  refund_status: 'none' | 'partial' | 'full';
  previous_order_status: string;
  new_order_status: string | null;
  status_changed: boolean;
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
    const isAdmin = userRoles.some(r => ['super_admin', 'admin', 'superadmin'].includes(r));

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { order_id, dry_run = false } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'order_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log attempt
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'refunds_recompute_attempt',
      meta: { order_id, dry_run },
    });

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .select('id, status, meta, final_price')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch bePaid payment for this order
    const { data: payment } = await supabase
      .from('payments_v2')
      .select('id, amount, refunds, refunded_amount, status')
      .eq('order_id', order_id)
      .eq('provider', 'bepaid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      return new Response(
        JSON.stringify({ 
          status: 'skipped',
          message: 'No bePaid payment found for this order',
          order_id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate refunded amount from refunds array
    const refunds = (payment.refunds || []) as any[];
    const calculatedRefunded = refunds
      .filter(r => r.status === 'succeeded')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const paymentAmount = Number(payment.amount) || 0;
    const refundedAmount = Math.max(calculatedRefunded, Number(payment.refunded_amount) || 0);

    // Determine refund status
    let refundStatus: 'none' | 'partial' | 'full' = 'none';
    if (refundedAmount > 0 && refundedAmount >= paymentAmount) {
      refundStatus = 'full';
    } else if (refundedAmount > 0) {
      refundStatus = 'partial';
    }

    // Determine if order status should change
    let newOrderStatus: string | null = null;
    const currentOrderStatus = order.status;
    
    // Only change order status to 'refunded' if it's a full refund and order is currently 'paid'
    if (refundStatus === 'full' && currentOrderStatus === 'paid') {
      newOrderStatus = 'refunded';
    }

    const result: RecomputeResult = {
      order_id,
      payment_id: payment.id,
      payment_amount: paymentAmount,
      refunded_amount: refundedAmount,
      refund_status: refundStatus,
      previous_order_status: currentOrderStatus,
      new_order_status: newOrderStatus,
      status_changed: !!newOrderStatus && newOrderStatus !== currentOrderStatus,
    };

    if (dry_run) {
      return new Response(
        JSON.stringify({
          status: 'dry_run',
          result,
          message: 'No changes made (dry run mode)',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update payment refunded_amount if different
    if (calculatedRefunded !== Number(payment.refunded_amount)) {
      await supabase
        .from('payments_v2')
        .update({ refunded_amount: calculatedRefunded })
        .eq('id', payment.id);
    }

    // Update order meta with refund status
    const currentMeta = (order.meta || {}) as Record<string, any>;
    const updatedMeta = {
      ...currentMeta,
      refund_status: refundStatus,
      refund_last_sync_at: new Date().toISOString(),
    };

    const orderUpdate: Record<string, any> = { meta: updatedMeta };
    
    // Only update order status to refunded if full refund
    if (newOrderStatus) {
      orderUpdate.status = newOrderStatus;
    }

    await supabase
      .from('orders_v2')
      .update(orderUpdate)
      .eq('id', order_id);

    // Log success
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'refunds_recompute_success',
      meta: { 
        order_id,
        refund_status: refundStatus,
        status_changed: result.status_changed,
        new_order_status: newOrderStatus,
      },
    });

    return new Response(
      JSON.stringify({
        status: 'success',
        result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('refunds-recompute-order-status error:', error);
    return new Response(
      JSON.stringify({ status: 'failed', error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
