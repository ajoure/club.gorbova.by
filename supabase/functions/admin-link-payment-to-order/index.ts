import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LinkPaymentRequest {
  source: 'reconcile_queue';
  queue_id: string;
  order_id: string;
  profile_id?: string | null;
  user_id?: string | null;
  actor_id: string;
}

interface StopError {
  code: 'PAYMENT_ALREADY_LINKED' | 'DUPLICATE_PROVIDER_UID' | 'PROFILE_MISMATCH' | 'ORDER_NOT_FOUND' | 'QUEUE_ITEM_NOT_FOUND' | 'VALIDATION_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: LinkPaymentRequest = await req.json();
    const { source, queue_id, order_id, profile_id, user_id, actor_id } = body;

    console.log(`[admin-link-payment-to-order] Starting: source=${source}, queue_id=${queue_id}, order_id=${order_id}`);

    // Validate required fields
    if (source !== 'reconcile_queue') {
      return errorResponse({ code: 'VALIDATION_ERROR', message: 'Only reconcile_queue source is supported' });
    }
    if (!queue_id || !order_id) {
      return errorResponse({ code: 'VALIDATION_ERROR', message: 'queue_id and order_id are required' });
    }

    // 1. Fetch queue item
    const { data: queueItem, error: queueError } = await supabase
      .from('payment_reconcile_queue')
      .select('*')
      .eq('id', queue_id)
      .single();

    if (queueError || !queueItem) {
      return errorResponse({ 
        code: 'QUEUE_ITEM_NOT_FOUND', 
        message: `Queue item not found: ${queue_id}`,
        details: { error: queueError?.message }
      });
    }

    // 2. Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .select('id, profile_id, user_id, order_number')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return errorResponse({ 
        code: 'ORDER_NOT_FOUND', 
        message: `Order not found: ${order_id}`,
        details: { error: orderError?.message }
      });
    }

    // STOP-A: Check if queue item is already linked to a DIFFERENT order
    if (queueItem.matched_order_id && queueItem.matched_order_id !== order_id) {
      return errorResponse({ 
        code: 'PAYMENT_ALREADY_LINKED', 
        message: `Payment is already linked to order ${queueItem.matched_order_id}`,
        details: { existing_order_id: queueItem.matched_order_id }
      });
    }

    // STOP-B: Check for duplicate provider_payment_id in payments_v2
    if (queueItem.bepaid_uid) {
      const { data: existingPayment } = await supabase
        .from('payments_v2')
        .select('id, order_id')
        .eq('provider_payment_id', queueItem.bepaid_uid)
        .maybeSingle();

      if (existingPayment && existingPayment.order_id !== order_id) {
        return errorResponse({ 
          code: 'DUPLICATE_PROVIDER_UID', 
          message: `Payment with UID ${queueItem.bepaid_uid} already exists for order ${existingPayment.order_id}`,
          details: { existing_payment_id: existingPayment.id, existing_order_id: existingPayment.order_id }
        });
      }

      // If payment already exists for THIS order - skip creating new, just update queue
      if (existingPayment && existingPayment.order_id === order_id) {
        console.log(`[admin-link-payment-to-order] Payment already exists for this order, updating queue only`);
        
        await supabase.from('payment_reconcile_queue').update({
          matched_order_id: order_id,
          matched_profile_id: profile_id || order.profile_id,
          status: 'manually_linked',
          linked_at: new Date().toISOString(),
        }).eq('id', queue_id);

        // Audit log
        await supabase.from('audit_logs').insert({
          actor_user_id: actor_id,
          action: 'admin.link_payment_to_order',
          target_user_id: user_id || order.user_id,
          meta: {
            source: 'reconcile_queue',
            queue_id,
            order_id,
            order_number: order.order_number,
            payment_id: existingPayment.id,
            profile_id: profile_id || order.profile_id,
            bepaid_uid: queueItem.bepaid_uid,
            note: 'payment_already_existed',
          },
        });

        return successResponse({
          payment_id: existingPayment.id,
          order_id,
          note: 'payment_already_existed',
        });
      }
    }

    // STOP-C: Check profile mismatch
    const finalProfileId = profile_id || order.profile_id;
    if (order.profile_id && profile_id && order.profile_id !== profile_id) {
      return errorResponse({ 
        code: 'PROFILE_MISMATCH', 
        message: `Order profile ${order.profile_id} does not match provided profile ${profile_id}`,
        details: { order_profile_id: order.profile_id, provided_profile_id: profile_id }
      });
    }

    // Determine user_id for the payment
    const finalUserId = user_id || order.user_id;

    // --- Begin atomic operations ---

    // 1. Update payment_reconcile_queue
    const { error: updateQueueError } = await supabase
      .from('payment_reconcile_queue')
      .update({
        matched_order_id: order_id,
        matched_profile_id: finalProfileId,
        status: 'manually_linked',
        linked_at: new Date().toISOString(),
      })
      .eq('id', queue_id);

    if (updateQueueError) {
      throw new Error(`Failed to update queue: ${updateQueueError.message}`);
    }

    // 2. Create payments_v2 record
    const { data: newPayment, error: createPaymentError } = await supabase
      .from('payments_v2')
      .insert({
        order_id: order_id,
        user_id: finalUserId,
        profile_id: finalProfileId,
        amount: queueItem.amount || 0,
        currency: queueItem.currency || 'BYN',
        status: 'succeeded',
        provider: 'bepaid',
        provider_payment_id: queueItem.bepaid_uid,
        paid_at: queueItem.paid_at || queueItem.created_at,
        card_brand: queueItem.card_brand,
        card_last4: queueItem.card_last4,
        meta: {
          source: 'admin_link',
          queue_id,
          linked_by: actor_id,
          linked_at: new Date().toISOString(),
          customer_email: queueItem.customer_email,
          customer_name: queueItem.customer_name,
          customer_surname: queueItem.customer_surname,
          customer_phone: queueItem.customer_phone,
          card_holder: queueItem.card_holder,
          product_name: queueItem.product_name,
          description: queueItem.description,
        },
      })
      .select('id')
      .single();

    if (createPaymentError) {
      throw new Error(`Failed to create payment: ${createPaymentError.message}`);
    }

    // 3. Update order profile_id if it was NULL
    if (!order.profile_id && finalProfileId) {
      await supabase
        .from('orders_v2')
        .update({ profile_id: finalProfileId })
        .eq('id', order_id);
    }

    // 4. Create audit log
    await supabase.from('audit_logs').insert({
      actor_user_id: actor_id,
      action: 'admin.link_payment_to_order',
      target_user_id: finalUserId,
      meta: {
        source: 'reconcile_queue',
        queue_id,
        order_id,
        order_number: order.order_number,
        payment_id: newPayment.id,
        profile_id: finalProfileId,
        amount: queueItem.amount,
        currency: queueItem.currency,
        bepaid_uid: queueItem.bepaid_uid,
      },
    });

    console.log(`[admin-link-payment-to-order] Success: payment_id=${newPayment.id}, order_id=${order_id}`);

    return successResponse({
      payment_id: newPayment.id,
      order_id,
      profile_id: finalProfileId,
    });

  } catch (error) {
    console.error('[admin-link-payment-to-order] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function errorResponse(stopError: StopError): Response {
  console.warn(`[admin-link-payment-to-order] STOP: ${stopError.code} - ${stopError.message}`);
  return new Response(
    JSON.stringify({ success: false, error: stopError.code, message: stopError.message, details: stopError.details }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function successResponse(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
