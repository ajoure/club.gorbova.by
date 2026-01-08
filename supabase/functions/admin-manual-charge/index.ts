import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ManualChargeRequest {
  action: 'manual_charge' | 'charge_installment';
  user_id?: string;
  payment_method_id?: string;
  amount?: number; // in kopecks
  description?: string;
  installment_id?: string;
  product_id?: string;
  tariff_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - must be admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return new Response(JSON.stringify({ success: false, error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: ManualChargeRequest = await req.json();
    const { action } = body;

    // Get bePaid settings
    const { data: settings } = await supabase
      .from('payment_settings')
      .select('key, value')
      .in('key', ['bepaid_shop_id', 'bepaid_test_mode']);

    const settingsMap: Record<string, string> = settings?.reduce(
      (acc: Record<string, string>, s: { key: string; value: string }) => ({ ...acc, [s.key]: s.value }),
      {}
    ) || {};

    const shopId = settingsMap['bepaid_shop_id'] || '33524';
    const testMode = settingsMap['bepaid_test_mode'] === 'true';
    const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);

    // Helper function to charge a card
    async function chargeCard(
      paymentToken: string,
      amountKopecks: number,
      currency: string,
      description: string,
      trackingId: string,
    ): Promise<{ success: boolean; uid?: string; error?: string; response?: any }> {
      const chargePayload = {
        request: {
          amount: amountKopecks,
          currency,
          description,
          tracking_id: trackingId,
          test: testMode,
          credit_card: {
            token: paymentToken,
          },
          additional_data: {
            contract: ['recurring', 'unscheduled'],
          },
        },
      };

      console.log('Charging card:', JSON.stringify({ ...chargePayload, request: { ...chargePayload.request, credit_card: { token: '***' } } }));

      const chargeResponse = await fetch('https://gateway.bepaid.by/transactions/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${bepaidAuth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-API-Version': '2',
        },
        body: JSON.stringify(chargePayload),
      });

      const chargeResult = await chargeResponse.json();
      console.log('bePaid response:', JSON.stringify(chargeResult));

      if (!chargeResponse.ok) {
        return { 
          success: false, 
          error: chargeResult.message || chargeResult.error || `bePaid error: ${chargeResponse.status}`,
          response: chargeResult,
        };
      }

      const txStatus = chargeResult.transaction?.status;
      const txUid = chargeResult.transaction?.uid;

      if (txStatus === 'successful') {
        return { success: true, uid: txUid, response: chargeResult };
      }

      return { 
        success: false, 
        error: chargeResult.transaction?.message || 'Payment failed',
        response: chargeResult,
      };
    }

    // ACTION: Manual charge
    if (action === 'manual_charge') {
      const { user_id, payment_method_id, amount, description, product_id, tariff_id } = body;

      if (!user_id || !payment_method_id || !amount || !product_id || !tariff_id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields: user_id, payment_method_id, amount, product_id, tariff_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get payment method
      const { data: paymentMethod, error: pmError } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('id', payment_method_id)
        .eq('user_id', user_id)
        .eq('status', 'active')
        .single();

      if (pmError || !paymentMethod) {
        return new Response(JSON.stringify({ success: false, error: 'Payment method not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get product and tariff info for order details
      const { data: product } = await supabase
        .from('products_v2')
        .select('name, code')
        .eq('id', product_id)
        .single();

      const { data: tariff } = await supabase
        .from('tariffs')
        .select('name, duration_days, access_duration_days')
        .eq('id', tariff_id)
        .single();

      // Generate order number
      const { data: orderNumberData } = await supabase.rpc('generate_order_number');
      const orderNumber = orderNumberData || `ORD-ADM-${Date.now()}`;

      // Create order for manual charge with product/tariff
      const { data: order, error: orderError } = await supabase
        .from('orders_v2')
        .insert({
          order_number: orderNumber,
          user_id,
          product_id,
          tariff_id,
          base_price: amount / 100, // Convert from kopecks to BYN
          final_price: amount / 100,
          paid_amount: 0,
          currency: 'BYN',
          status: 'pending',
          customer_email: paymentMethod.meta?.email || null,
          meta: {
            type: 'admin_manual_charge',
            description,
            charged_by: user.id,
            charged_by_action: 'admin_charge_dialog',
            product_name: product?.name,
            tariff_name: tariff?.name,
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error('Order creation error:', orderError);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create payment record
      const { data: payment, error: paymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order.id,
          user_id,
          amount: amount / 100, // Convert from kopecks to BYN
          currency: 'BYN',
          status: 'processing',
          provider: 'bepaid',
          payment_token: paymentMethod.provider_token,
          is_recurring: false,
          meta: { 
            type: 'admin_manual_charge',
            description,
            charged_by: user.id,
            payment_method_id,
          },
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment record error:', paymentError);
        // Cleanup the order
        await supabase.from('orders_v2').delete().eq('id', order.id);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create payment record' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Charge the card
      const chargeResult = await chargeCard(
        paymentMethod.provider_token,
        amount,
        'BYN',
        description || 'Ручное списание',
        payment.id,
      );

      if (chargeResult.success) {
        // Update payment as succeeded
        await supabase
          .from('payments_v2')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            provider_payment_id: chargeResult.uid,
            provider_response: chargeResult.response,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
          })
          .eq('id', payment.id);

        // Update order as paid/completed
        await supabase
          .from('orders_v2')
          .update({
            status: 'paid',
            paid_amount: amount / 100,
          })
          .eq('id', order.id);

        // Calculate access dates
        const now = new Date();
        const durationDays = tariff?.access_duration_days || tariff?.duration_days || 365;
        const accessEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        // Create subscription (entitlement)
        const { data: subscription, error: subError } = await supabase
          .from('subscriptions_v2')
          .insert({
            user_id,
            order_id: order.id,
            product_id,
            tariff_id,
            status: 'active',
            payment_token: paymentMethod.provider_token,
            access_start: now.toISOString(),
            access_end: accessEnd.toISOString(),
            meta: {
              source: 'admin_manual_charge',
              charged_by: user.id,
              description,
            },
          })
          .select()
          .single();

        if (subError) {
          console.error('Subscription creation error:', subError);
          // Don't fail the payment, just log it
        }

        // Audit log
        await supabase.from('audit_logs').insert({
          actor_user_id: user.id,
          target_user_id: user_id,
          action: 'payment.admin_manual_charge',
          meta: {
            payment_id: payment.id,
            order_id: order.id,
            order_number: orderNumber,
            subscription_id: subscription?.id,
            product_id,
            tariff_id,
            product_name: product?.name,
            tariff_name: tariff?.name,
            amount: amount / 100,
            currency: 'BYN',
            description,
            bepaid_uid: chargeResult.uid,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
            access_start: now.toISOString(),
            access_end: accessEnd.toISOString(),
          },
        });

        console.log(`Manual charge successful: order=${orderNumber}, payment=${payment.id}, subscription=${subscription?.id}, amount=${amount / 100} BYN`);

        return new Response(JSON.stringify({
          success: true,
          payment_id: payment.id,
          order_id: order.id,
          order_number: orderNumber,
          subscription_id: subscription?.id,
          bepaid_uid: chargeResult.uid,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Update payment as failed
        await supabase
          .from('payments_v2')
          .update({
            status: 'failed',
            error_message: chargeResult.error,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        // Update order status to failed
        await supabase
          .from('orders_v2')
          .update({
            status: 'cancelled',
            meta: {
              ...order.meta,
              error: chargeResult.error,
            },
          })
          .eq('id', order.id);

        // Audit log for failed charge
        await supabase.from('audit_logs').insert({
          actor_user_id: user.id,
          target_user_id: user_id,
          action: 'payment.admin_manual_charge_failed',
          meta: {
            payment_id: payment.id,
            order_id: order.id,
            order_number: orderNumber,
            product_id,
            tariff_id,
            amount: amount / 100,
            error: chargeResult.error,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
          },
        });

        return new Response(JSON.stringify({
          success: false,
          error: chargeResult.error,
          payment_id: payment.id,
          order_number: orderNumber,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ACTION: Charge installment
    if (action === 'charge_installment') {
      const { installment_id } = body;

      if (!installment_id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing installment_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get installment with subscription and payment method
      const { data: installment, error: instError } = await supabase
        .from('installment_payments')
        .select(`
          *,
          subscriptions_v2 (
            id, user_id, payment_method_id, payment_token,
            products_v2 ( name, currency )
          )
        `)
        .eq('id', installment_id)
        .eq('status', 'pending')
        .single();

      if (instError || !installment) {
        return new Response(JSON.stringify({ success: false, error: 'Installment not found or already processed' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const subscription = installment.subscriptions_v2;
      if (!subscription?.payment_token) {
        return new Response(JSON.stringify({ success: false, error: 'No payment token for subscription' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update installment status to processing
      await supabase
        .from('installment_payments')
        .update({ 
          status: 'processing',
          last_attempt_at: new Date().toISOString(),
          charge_attempts: (installment.charge_attempts || 0) + 1,
        })
        .eq('id', installment_id);

      // Create payment record
      const { data: payment, error: paymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: installment.order_id,
          user_id: installment.user_id,
          amount: installment.amount,
          currency: installment.currency,
          status: 'processing',
          provider: 'bepaid',
          payment_token: subscription.payment_token,
          is_recurring: true,
          installment_number: installment.payment_number,
          meta: {
            type: 'installment_charge',
            installment_id: installment.id,
            subscription_id: subscription.id,
            charged_by: user.id,
          },
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment record error:', paymentError);
        await supabase
          .from('installment_payments')
          .update({ status: 'pending', error_message: 'Failed to create payment record' })
          .eq('id', installment_id);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create payment record' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Charge the card
      const currency = subscription.products_v2?.currency || 'BYN';
      const productName = subscription.products_v2?.name || 'Продукт';
      const chargeResult = await chargeCard(
        subscription.payment_token,
        Math.round(Number(installment.amount) * 100),
        currency,
        `Рассрочка ${installment.payment_number}/${installment.total_payments}: ${productName}`,
        payment.id,
      );

      if (chargeResult.success) {
        // Update payment
        await supabase
          .from('payments_v2')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            provider_payment_id: chargeResult.uid,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        // Update installment
        await supabase
          .from('installment_payments')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            payment_id: payment.id,
            error_message: null,
          })
          .eq('id', installment_id);

        // Update order paid_amount
        const { data: currentOrder } = await supabase
          .from('orders_v2')
          .select('paid_amount')
          .eq('id', installment.order_id)
          .single();

        await supabase
          .from('orders_v2')
          .update({ 
            paid_amount: (currentOrder?.paid_amount || 0) + Number(installment.amount),
          })
          .eq('id', installment.order_id);

        // Audit log
        await supabase.from('audit_logs').insert({
          actor_user_id: user.id,
          target_user_id: installment.user_id,
          action: 'payment.installment_charged',
          meta: {
            installment_id: installment.id,
            payment_id: payment.id,
            payment_number: installment.payment_number,
            amount: installment.amount,
            bepaid_uid: chargeResult.uid,
          },
        });

        console.log(`Installment charge successful: ${installment_id}, payment: ${payment.id}`);

        return new Response(JSON.stringify({
          success: true,
          payment_id: payment.id,
          installment_id,
          bepaid_uid: chargeResult.uid,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Update payment as failed
        await supabase
          .from('payments_v2')
          .update({
            status: 'failed',
            error_message: chargeResult.error,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        // Update installment status back to pending (or failed if max attempts)
        const maxAttempts = 3;
        const newStatus = (installment.charge_attempts || 0) + 1 >= maxAttempts ? 'failed' : 'pending';
        
        await supabase
          .from('installment_payments')
          .update({ 
            status: newStatus,
            error_message: chargeResult.error,
          })
          .eq('id', installment_id);

        return new Response(JSON.stringify({
          success: false,
          error: chargeResult.error,
          payment_id: payment.id,
          installment_id,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Admin manual charge error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
