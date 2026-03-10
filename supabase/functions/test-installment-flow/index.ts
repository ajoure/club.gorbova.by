import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Test function to simulate installment payment scenarios
 * 
 * Scenarios:
 * 1. Create test order with installment schedule (300 BYN, 3 payments, 30 days)
 * 2. Simulate successful payment of 1st, 2nd, 3rd installments
 * 3. Simulate failed payment attempts
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - must be super_admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Super admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, testUserId, installmentId } = body;

    const results: any = { action, timestamp: new Date().toISOString() };

    // ============================================================
    // ACTION: create_test_scenario
    // Creates a test order with 3 installments of 100 BYN each
    // ============================================================
    if (action === 'create_test_scenario') {
      const totalAmount = 300;
      const installmentCount = 3;
      const intervalDays = 30;
      const perPayment = totalAmount / installmentCount;

      // Get a product and tariff for testing
      const { data: product } = await supabase
        .from('products_v2')
        .select('id, name, currency')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!product) {
        return new Response(JSON.stringify({ error: 'No active product found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: tariff } = await supabase
        .from('tariffs')
        .select('id, name, code, access_days')
        .eq('product_id', product.id)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!tariff) {
        return new Response(JSON.stringify({ error: 'No active tariff found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const targetUserId = testUserId || user.id;

      // Get user's payment method
      const { data: paymentMethod } = await supabase
        .from('payment_methods')
        .select('id, provider_token, brand, last4')
        .eq('user_id', targetUserId)
        .eq('status', 'active')
        .eq('is_default', true)
        .single();

      // Create test order
      const orderNumber = `TEST-INST-${Date.now().toString(36).toUpperCase()}`;
      const { data: order, error: orderError } = await supabase
        .from('orders_v2')
        .insert({
          order_number: orderNumber,
          user_id: targetUserId,
          product_id: product.id,
          tariff_id: tariff.id,
          customer_email: user.email,
          base_price: totalAmount,
          final_price: totalAmount,
          paid_amount: perPayment, // First payment "paid"
          currency: product.currency,
          is_trial: false,
          status: 'paid',
          deal_date: new Date().toISOString(),
          meta: {
            test_scenario: true,
            is_installment: true,
            installment_count: installmentCount,
            first_payment_amount: perPayment,
          },
        })
        .select()
        .single();

      if (orderError) {
        return new Response(JSON.stringify({ error: 'Order creation failed', details: orderError }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create subscription
      const accessDays = tariff.access_days || 365;
      const accessEndAt = new Date(Date.now() + accessDays * 24 * 60 * 60 * 1000);

      const { data: subscription, error: subError } = await supabase
        .from('subscriptions_v2')
        .insert({
          user_id: targetUserId,
          product_id: product.id,
          tariff_id: tariff.id,
          order_id: order.id,
          status: 'active',
          is_trial: false,
          access_start_at: new Date().toISOString(),
          access_end_at: accessEndAt.toISOString(),
          payment_method_id: paymentMethod?.id || null,
          payment_token: paymentMethod?.provider_token || null,
          meta: { test_scenario: true },
        })
        .select()
        .single();

      if (subError) {
        return new Response(JSON.stringify({ error: 'Subscription creation failed', details: subError }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create first payment record (succeeded)
      const { data: firstPayment } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order.id,
          user_id: targetUserId,
          amount: perPayment,
          currency: product.currency,
          status: 'succeeded',
          provider: 'bepaid',
          payment_token: paymentMethod?.provider_token || 'test_token',
          is_recurring: true,
          installment_number: 1,
          paid_at: new Date().toISOString(),
          meta: { test_scenario: true },
        })
        .select()
        .single();

      // Create installment payments schedule
      const installmentPayments = [];
      for (let i = 0; i < installmentCount; i++) {
        const delayDays = i * intervalDays;
        const dueDate = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
        
        installmentPayments.push({
          subscription_id: subscription.id,
          order_id: order.id,
          user_id: targetUserId,
          payment_number: i + 1,
          total_payments: installmentCount,
          amount: perPayment,
          currency: product.currency,
          due_date: dueDate.toISOString(),
          status: i === 0 ? 'succeeded' : 'pending',
          paid_at: i === 0 ? new Date().toISOString() : null,
          payment_id: i === 0 ? firstPayment?.id : null,
          meta: { test_scenario: true },
        });
      }

      const { data: createdInstallments, error: instError } = await supabase
        .from('installment_payments')
        .insert(installmentPayments)
        .select();

      if (instError) {
        return new Response(JSON.stringify({ error: 'Installments creation failed', details: instError }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      results.scenario = {
        totalAmount,
        installmentCount,
        perPayment,
        intervalDays,
        order: { id: order.id, order_number: orderNumber },
        subscription: { id: subscription.id },
        installments: createdInstallments,
        paymentMethod: paymentMethod ? `${paymentMethod.brand} **** ${paymentMethod.last4}` : 'none',
      };

      results.message = `✅ Test scenario created: ${installmentCount} payments of ${perPayment} BYN`;
    }

    // ============================================================
    // ACTION: simulate_successful_payment
    // Simulates successful charge of a pending installment
    // ============================================================
    else if (action === 'simulate_successful_payment') {
      if (!installmentId) {
        return new Response(JSON.stringify({ error: 'installmentId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get installment
      const { data: installment, error: instError } = await supabase
        .from('installment_payments')
        .select('*, subscriptions_v2(id, user_id, payment_token)')
        .eq('id', installmentId)
        .single();

      if (instError || !installment) {
        return new Response(JSON.stringify({ error: 'Installment not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (installment.status !== 'pending') {
        return new Response(JSON.stringify({ error: `Installment status is ${installment.status}, not pending` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create payment record
      const { data: payment } = await supabase
        .from('payments_v2')
        .insert({
          order_id: installment.order_id,
          user_id: installment.user_id,
          amount: installment.amount,
          currency: installment.currency,
          status: 'succeeded',
          provider: 'bepaid',
          payment_token: installment.subscriptions_v2?.payment_token || 'test_token',
          is_recurring: true,
          installment_number: installment.payment_number,
          paid_at: new Date().toISOString(),
          provider_payment_id: `test_${Date.now()}`,
          meta: { 
            type: 'installment_charge',
            simulated: true,
            installment_id: installmentId,
          },
        })
        .select()
        .single();

      // Update installment
      await supabase
        .from('installment_payments')
        .update({
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          payment_id: payment?.id,
          error_message: null,
        })
        .eq('id', installmentId);

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

      results.message = `✅ Payment ${installment.payment_number}/${installment.total_payments} simulated successfully`;
      results.payment = payment;
      results.amount = installment.amount;
    }

    // ============================================================
    // ACTION: simulate_failed_payment
    // Simulates failed charge attempt
    // ============================================================
    else if (action === 'simulate_failed_payment') {
      if (!installmentId) {
        return new Response(JSON.stringify({ error: 'installmentId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get installment
      const { data: installment, error: instError } = await supabase
        .from('installment_payments')
        .select('*')
        .eq('id', installmentId)
        .single();

      if (instError || !installment) {
        return new Response(JSON.stringify({ error: 'Installment not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const currentAttempts = installment.charge_attempts || 0;
      const maxAttempts = 3;
      const newAttempts = currentAttempts + 1;
      const newStatus = newAttempts >= maxAttempts ? 'failed' : 'pending';
      const errorMessage = 'SIMULATED: Insufficient funds (test error)';

      // Create failed payment record
      const { data: payment } = await supabase
        .from('payments_v2')
        .insert({
          order_id: installment.order_id,
          user_id: installment.user_id,
          amount: installment.amount,
          currency: installment.currency,
          status: 'failed',
          provider: 'bepaid',
          is_recurring: true,
          installment_number: installment.payment_number,
          error_message: errorMessage,
          meta: { 
            type: 'installment_charge',
            simulated: true,
            installment_id: installmentId,
            attempt_number: newAttempts,
          },
        })
        .select()
        .single();

      // Update installment
      await supabase
        .from('installment_payments')
        .update({
          status: newStatus,
          charge_attempts: newAttempts,
          last_attempt_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq('id', installmentId);

      results.message = newStatus === 'failed'
        ? `❌ Payment ${installment.payment_number}/${installment.total_payments} FAILED after ${newAttempts} attempts (max reached)`
        : `⚠️ Payment ${installment.payment_number}/${installment.total_payments} failed, attempt ${newAttempts}/${maxAttempts}`;
      results.attempts = newAttempts;
      results.maxAttempts = maxAttempts;
      results.newStatus = newStatus;
      results.payment = payment;
    }

    // ============================================================
    // ACTION: get_installment_status
    // Gets current status of all installments for a subscription
    // ============================================================
    else if (action === 'get_installment_status') {
      const { subscriptionId } = body;
      
      if (!subscriptionId) {
        return new Response(JSON.stringify({ error: 'subscriptionId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: installments } = await supabase
        .from('installment_payments')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('payment_number', { ascending: true });

      const { data: order } = await supabase
        .from('orders_v2')
        .select('id, order_number, final_price, paid_amount, status')
        .eq('id', installments?.[0]?.order_id)
        .single();

      const totalPaid = installments?.filter(i => i.status === 'succeeded').reduce((sum, i) => sum + Number(i.amount), 0) || 0;
      const totalPending = installments?.filter(i => i.status === 'pending').reduce((sum, i) => sum + Number(i.amount), 0) || 0;
      const totalFailed = installments?.filter(i => i.status === 'failed').reduce((sum, i) => sum + Number(i.amount), 0) || 0;

      results.installments = installments;
      results.summary = {
        order,
        totalPaid,
        totalPending,
        totalFailed,
        succeededCount: installments?.filter(i => i.status === 'succeeded').length || 0,
        pendingCount: installments?.filter(i => i.status === 'pending').length || 0,
        failedCount: installments?.filter(i => i.status === 'failed').length || 0,
      };
    }

    // ============================================================
    // ACTION: cleanup_test_data
    // Removes test scenario data
    // ============================================================
    else if (action === 'cleanup_test_data') {
      const { data: testOrders } = await supabase
        .from('orders_v2')
        .select('id')
        .like('order_number', 'TEST-INST-%');

      if (testOrders && testOrders.length > 0) {
        const orderIds = testOrders.map(o => o.id);
        
        await supabase.from('installment_payments').delete().in('order_id', orderIds);
        await supabase.from('payments_v2').delete().in('order_id', orderIds);
        await supabase.from('subscriptions_v2').delete().in('order_id', orderIds);
        await supabase.from('orders_v2').delete().in('id', orderIds);

        results.message = `🧹 Cleaned up ${testOrders.length} test orders`;
        results.deletedOrderIds = orderIds;
      } else {
        results.message = 'No test data found to clean up';
      }
    }

    else {
      return new Response(JSON.stringify({ 
        error: 'Invalid action',
        validActions: [
          'create_test_scenario',
          'simulate_successful_payment',
          'simulate_failed_payment',
          'get_installment_status',
          'cleanup_test_data',
        ],
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Test installment flow error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
