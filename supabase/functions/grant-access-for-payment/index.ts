/**
 * PATCH 2: Facade for grant-access with payment ID
 * 
 * This facade ensures the "1 payment = 1 order" invariant by:
 * 1. Calling ensureOrderForPayment(paymentId) to guarantee a valid order exists
 * 2. Then calling grant-access-for-order(resolvedOrderId) with the strict contract
 * 
 * All callers that have paymentId should use this facade, NOT grant-access-for-order directly.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ensureOrderForPayment } from '../_shared/ensure-order-for-payment.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      paymentId,
      customAccessDays,
      extendFromCurrent = true,
      grantTelegram = true,
      grantGetcourse = true,
    } = await req.json();

    // Guard: paymentId is required for this facade
    if (!paymentId) {
      await supabase.from('audit_logs').insert({
        action: 'payment.grant_blocked_no_payment_id',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'grant-access-for-payment',
        meta: { reason: 'payment_id_required' },
      });

      return new Response(
        JSON.stringify({
          error: 'paymentId is required',
          details: 'Use grant-access-for-order if you have an orderId directly.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Ensure payment has a valid order (creates one if needed)
    console.log(`[grant-access-for-payment] Ensuring order for payment ${paymentId}`);
    const ensureResult = await ensureOrderForPayment(supabase, paymentId, 'grant-access-for-payment');

    if (ensureResult.action === 'error' || !ensureResult.orderId) {
      // Log failure
      await supabase.from('audit_logs').insert({
        action: 'payment.ensure_order_failed',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'grant-access-for-payment',
        meta: {
          payment_id: paymentId,
          ensure_action: ensureResult.action,
          reason: ensureResult.reason,
        },
      });

      return new Response(
        JSON.stringify({
          error: 'Failed to ensure order for payment',
          details: ensureResult.reason,
          ensureResult,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resolvedOrderId = ensureResult.orderId;
    console.log(`[grant-access-for-payment] Resolved order ${resolvedOrderId} (action: ${ensureResult.action})`);

    // ============= PATCH 4: Check if resolved order needs mapping =============
    if (resolvedOrderId) {
      const { data: orderCheck } = await supabase
        .from('orders_v2')
        .select('status, meta')
        .eq('id', resolvedOrderId)
        .single();
      
      const orderMeta = (orderCheck?.meta || {}) as Record<string, any>;
      const isNeedsMapping = orderCheck?.status === 'needs_mapping';
      const hasMappingApplied = !!orderMeta.mapping_applied_at;
      
      if (isNeedsMapping && !hasMappingApplied) {
        await supabase.from('audit_logs').insert({
          action: 'access.grant_blocked_needs_mapping',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'grant-access-for-payment',
          meta: {
            payment_id: paymentId,
            order_id: resolvedOrderId,
            reason: 'needs_mapping_without_applied_at',
          },
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: 'needs_mapping_blocked',
            message: 'Order requires manual product mapping before access can be granted.',
            paymentId,
            orderId: resolvedOrderId,
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    // ============= END PATCH 4 =============

    // Step 2: Call grant-access-for-order with the resolved orderId
    // Using internal function call to avoid HTTP overhead
    const grantResponse = await fetch(`${supabaseUrl}/functions/v1/grant-access-for-order`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: resolvedOrderId,
        customAccessDays,
        extendFromCurrent,
        grantTelegram,
        grantGetcourse,
      }),
    });

    const grantResult = await grantResponse.json();

    if (!grantResponse.ok) {
      console.error(`[grant-access-for-payment] grant-access-for-order failed:`, grantResult);
      return new Response(
        JSON.stringify({
          error: 'Grant access failed',
          details: grantResult,
          ensureResult,
        }),
        { status: grantResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success: return combined result
    return new Response(
      JSON.stringify({
        success: true,
        paymentId,
        orderId: resolvedOrderId,
        ensureResult: {
          action: ensureResult.action,
          wasOrphan: ensureResult.wasOrphan,
          wasTrialMismatch: ensureResult.wasTrialMismatch,
        },
        grantResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[grant-access-for-payment] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal error',
        details: (error as Error).message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
