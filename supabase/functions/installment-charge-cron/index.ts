import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function should be called by a cron job daily
// It processes pending installment payments that are due

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting installment charge cron job...');

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

    // Find pending installments that are due
    const now = new Date().toISOString();
    const { data: dueInstallments, error: fetchError } = await supabase
      .from('installment_payments')
      .select(`
        *,
        subscriptions_v2 (
          id, user_id, payment_method_id, payment_token, status,
          products_v2 ( name, currency )
        )
      `)
      .eq('status', 'pending')
      .lte('due_date', now)
      .lt('charge_attempts', 3) // Max 3 attempts
      .order('due_date', { ascending: true })
      .limit(50); // Process in batches

    if (fetchError) {
      console.error('Error fetching due installments:', fetchError);
      return new Response(JSON.stringify({ success: false, error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${dueInstallments?.length || 0} due installments to process`);

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const installment of dueInstallments || []) {
      results.processed++;
      const subscription = installment.subscriptions_v2;

      // Skip if subscription is not active or has no payment token
      if (!subscription?.payment_token || !['active', 'trial'].includes(subscription.status)) {
        console.log(`Skipping installment ${installment.id}: subscription inactive or no token`);
        results.skipped++;
        continue;
      }

      try {
        // Update installment status to processing
        await supabase
          .from('installment_payments')
          .update({ 
            status: 'processing',
            last_attempt_at: new Date().toISOString(),
            charge_attempts: (installment.charge_attempts || 0) + 1,
          })
          .eq('id', installment.id);

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
              type: 'installment_auto_charge',
              installment_id: installment.id,
              subscription_id: subscription.id,
            },
          })
          .select()
          .single();

        if (paymentError) {
          throw new Error(`Failed to create payment record: ${paymentError.message}`);
        }

        // Charge the card
        const currency = subscription.products_v2?.currency || 'BYN';
        const productName = subscription.products_v2?.name || 'Продукт';

        const chargePayload = {
          request: {
            amount: Math.round(Number(installment.amount) * 100),
            currency,
            description: `Рассрочка ${installment.payment_number}/${installment.total_payments}: ${productName}`,
            tracking_id: payment.id,
            test: testMode,
            credit_card: {
              token: subscription.payment_token,
            },
            additional_data: {
              contract: ['recurring', 'unscheduled'],
            },
          },
        };

        console.log(`Charging installment ${installment.id}: ${installment.amount} ${currency}`);

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
        const txStatus = chargeResult.transaction?.status;
        const txUid = chargeResult.transaction?.uid;

        if (txStatus === 'successful') {
          // Update payment
          await supabase
            .from('payments_v2')
            .update({
              status: 'succeeded',
              paid_at: new Date().toISOString(),
              provider_payment_id: txUid,
              provider_response: chargeResult,
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
            .eq('id', installment.id);

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
            actor_user_id: installment.user_id,
            action: 'payment.installment_auto_charged',
            meta: {
              installment_id: installment.id,
              payment_id: payment.id,
              payment_number: installment.payment_number,
              amount: installment.amount,
              bepaid_uid: txUid,
            },
          });

          console.log(`Installment ${installment.id} charged successfully`);
          results.successful++;
        } else {
          // Payment failed
          const errorMessage = chargeResult.transaction?.message || chargeResult.errors?.base?.[0] || 'Payment failed';
          
          await supabase
            .from('payments_v2')
            .update({
              status: 'failed',
              error_message: errorMessage,
              provider_response: chargeResult,
            })
            .eq('id', payment.id);

          // Update installment - back to pending or failed if max attempts
          const maxAttempts = 3;
          const newAttempts = (installment.charge_attempts || 0) + 1;
          const newStatus = newAttempts >= maxAttempts ? 'failed' : 'pending';
          
          await supabase
            .from('installment_payments')
            .update({ 
              status: newStatus,
              error_message: errorMessage,
            })
            .eq('id', installment.id);

          console.error(`Installment ${installment.id} charge failed: ${errorMessage}`);
          results.failed++;
          results.errors.push(`${installment.id}: ${errorMessage}`);

          // TODO: Send notification to user about failed payment
        }
      } catch (error) {
        console.error(`Error processing installment ${installment.id}:`, error);
        
        // Revert to pending status
        await supabase
          .from('installment_payments')
          .update({ 
            status: 'pending',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', installment.id);

        results.failed++;
        results.errors.push(`${installment.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Small delay between charges to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('Installment charge cron completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Installment charge cron error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
