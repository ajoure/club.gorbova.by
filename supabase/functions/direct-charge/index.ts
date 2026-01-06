import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send order to GetCourse
async function sendToGetCourse(
  email: string,
  phone: string | null,
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log(`No getcourse_offer_id for tariff: ${tariffCode}, skipping GetCourse sync`);
    return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
  }
  
  try {
    console.log(`Sending order to GetCourse: email=${email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    const params = {
      user: {
        email: email,
        phone: phone || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_cost: amount / 100, // Convert from kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    // Check result.success, not top-level success (which is just API call status)
    if (data.result?.success === true) {
      console.log('Order successfully sent to GetCourse, deal_id:', data.result?.deal_id);
      return { success: true, gcOrderId: data.result?.deal_id?.toString() };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

interface DirectChargeRequest {
  productId: string;
  tariffCode: string;
  isTrial?: boolean;
  trialDays?: number;
  paymentMethodId?: string; // If not provided, use default card
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

    // Auth check
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

    const body: DirectChargeRequest = await req.json();
    const { productId, tariffCode, isTrial, trialDays, paymentMethodId } = body;

    console.log(`Direct charge for user ${user.id}: product=${productId}, tariff=${tariffCode}, trial=${isTrial}`);

    // Get user's payment method
    let paymentMethodQuery = supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');
    
    if (paymentMethodId) {
      paymentMethodQuery = paymentMethodQuery.eq('id', paymentMethodId);
    } else {
      paymentMethodQuery = paymentMethodQuery.eq('is_default', true);
    }

    const { data: paymentMethod } = await paymentMethodQuery.single();

    if (!paymentMethod) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No payment method found',
        requiresTokenization: true,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Using payment method: ${paymentMethod.brand} **** ${paymentMethod.last4}`);

    // Get product and tariff info
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, name, currency, telegram_club_id')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (!product) {
      return new Response(JSON.stringify({ success: false, error: 'Product not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tariff } = await supabase
      .from('tariffs')
      .select('id, name, code, access_days, original_price, trial_days, trial_price, trial_auto_charge, getcourse_offer_id')
      .eq('code', tariffCode)
      .eq('product_id', productId)
      .eq('is_active', true)
      .single();

    if (!tariff) {
      return new Response(JSON.stringify({ success: false, error: 'Tariff not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get offer data
    const offerType = isTrial ? 'trial' : 'pay_now';
    const { data: offer } = await supabase
      .from('tariff_offers')
      .select('*')
      .eq('tariff_id', tariff.id)
      .eq('offer_type', offerType)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .limit(1)
      .single();

    const amount = offer?.amount ?? (isTrial ? tariff.trial_price : tariff.original_price) ?? 0;
    const effectiveTrialDays = offer?.trial_days ?? trialDays ?? tariff.trial_days ?? 5;
    const autoChargeAmount = offer?.auto_charge_amount ?? tariff.original_price ?? 0;
    const autoChargeAfterTrial = offer?.auto_charge_after_trial ?? tariff.trial_auto_charge ?? true;
    const isRecurringSubscription = offer?.requires_card_tokenization ?? false;

    console.log(`Charge amount: ${amount} ${product.currency}, trial=${isTrial}, days=${effectiveTrialDays}`);

    // Check if user already has an active subscription for this product
    // For trial - block if already used trial for this product
    // For regular purchase - allow and extend access
    // IMPORTANT: exclude canceled subscriptions (canceled_at IS NOT NULL) - they should not be reused
    const { data: existingSub } = await supabase
      .from('subscriptions_v2')
      .select('id, status, access_end_at, is_trial, canceled_at')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .in('status', ['active', 'trial'])
      .is('canceled_at', null) // Only extend subscriptions that are not canceled
      .gte('access_end_at', new Date().toISOString())
      .order('access_end_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Block trial if user already used trial for this product
    if (isTrial) {
      const { data: usedTrial } = await supabase
        .from('subscriptions_v2')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .eq('is_trial', true)
        .limit(1)
        .maybeSingle();

      if (usedTrial) {
        console.log(`User already used trial for this product`);
        return new Response(JSON.stringify({
          success: false,
          error: 'Вы уже использовали пробный период для этого продукта',
          alreadyUsedTrial: true,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // For regular purchase with active subscription - extend access period
    let extendFromDate: Date | null = null;
    if (existingSub && !isTrial) {
      extendFromDate = new Date(existingSub.access_end_at);
      console.log(`User has active subscription until ${extendFromDate.toISOString()}, will extend from that date`);
    }

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

    // Generate order number
    const orderNumber = `ORD-${new Date().getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id: user.id,
        product_id: productId,
        tariff_id: tariff.id,
        customer_email: user.email,
        base_price: amount,
        final_price: amount,
        currency: product.currency,
        is_trial: isTrial || false,
        trial_end_at: isTrial ? new Date(Date.now() + effectiveTrialDays * 24 * 60 * 60 * 1000).toISOString() : null,
        status: 'pending',
        meta: {
          payment_method_id: paymentMethod.id,
          direct_charge: true,
          auto_charge_after_trial: autoChargeAfterTrial,
          auto_charge_amount: autoChargeAmount,
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

    console.log(`Created order ${order.id}`);

    // For trial with 0 amount, just activate without charging
    if (isTrial && amount === 0) {
      console.log('Trial with 0 amount - activating without charge');

      // Create subscription
      const trialEndAt = new Date(Date.now() + effectiveTrialDays * 24 * 60 * 60 * 1000);
      const nextChargeAt = autoChargeAfterTrial 
        ? new Date(trialEndAt.getTime() - 24 * 60 * 60 * 1000) // 1 day before trial ends
        : null;

      const { data: subscription, error: subError } = await supabase
        .from('subscriptions_v2')
        .insert({
          user_id: user.id,
          product_id: productId,
          tariff_id: tariff.id,
          order_id: order.id,
          status: 'trial',
          is_trial: true,
          access_start_at: new Date().toISOString(),
          access_end_at: trialEndAt.toISOString(),
          trial_end_at: trialEndAt.toISOString(),
          payment_method_id: paymentMethod.id,
          payment_token: paymentMethod.provider_token,
          next_charge_at: nextChargeAt?.toISOString() || null,
        })
        .select()
        .single();

      if (subError) {
        console.error('Subscription creation error:', subError);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create subscription' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Mark order as paid (trial amount = 0 does not create a bePaid charge)
      const { error: orderUpdateError } = await supabase
        .from('orders_v2')
        .update({ status: 'paid', paid_amount: 0 })
        .eq('id', order.id);

      if (orderUpdateError) {
        console.error('Order update error:', orderUpdateError);
      }

      // Create internal payment record for history/audit
      const { error: trialPaymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order.id,
          user_id: user.id,
          amount: 0,
          currency: product.currency,
          status: 'succeeded',
          provider: 'bepaid',
          payment_token: paymentMethod.provider_token,
          is_recurring: false,
          meta: {
            kind: 'trial_activation_no_charge',
            payment_method_id: paymentMethod.id,
          },
        });

      if (trialPaymentError) {
        console.error('Trial payment record error:', trialPaymentError);
      }

      // Grant Telegram access
      if (product.telegram_club_id) {
        await supabase.functions.invoke('telegram-grant-access', {
          body: {
            user_id: user.id,
            duration_days: effectiveTrialDays,
          },
        });
      }

      // Audit log
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'subscription.trial_activated',
        meta: {
          order_id: order.id,
          subscription_id: subscription.id,
          product_id: productId,
          tariff_code: tariffCode,
          trial_days: effectiveTrialDays,
          payment_method: `${paymentMethod.brand} **** ${paymentMethod.last4}`,
        },
      });

      console.log(`Trial activated: subscription ${subscription.id}`);

      return new Response(JSON.stringify({
        success: true,
        orderId: order.id,
        subscriptionId: subscription.id,
        isTrial: true,
        trialEndsAt: trialEndAt.toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For paid transactions, charge the card
    console.log(`Charging ${amount} ${product.currency} using token ${paymentMethod.provider_token.substring(0, 8)}...`);

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments_v2')
      .insert({
        order_id: order.id,
        user_id: user.id,
        amount,
        currency: product.currency,
        status: 'processing',
        provider: 'bepaid',
        payment_token: paymentMethod.provider_token,
        is_recurring: false,
        meta: { payment_method_id: paymentMethod.id },
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to create payment' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call bePaid Gateway API to charge the token
    // Important: For token charges, use gateway.bepaid.by/transactions/payments with additional_data.contract
    const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);

    // Build URLs from the request origin to support preview domains (and avoid hanging redirects).
    const reqOrigin = req.headers.get('origin');
    const reqReferer = req.headers.get('referer');
    const origin = reqOrigin
      || (reqReferer ? new URL(reqReferer).origin : null)
      || 'https://club.gorbova.by';

    // bePaid webhook receiver (so we can finalize payment after 3DS)
    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;

    // Return to purchases with "processing" state. UI will show success ONLY after confirmed provider status.
    const returnUrl = `${origin}/purchases?payment=processing&order=${order.id}`;

    const chargePayload = {
      request: {
        amount: Math.round(amount * 100), // minimal currency units
        currency: product.currency,
        description: isTrial
          ? `Trial: ${product.name} - ${tariff.name}`
          : `${product.name} - ${tariff.name}`,
        tracking_id: payment.id,
        test: testMode,
        return_url: returnUrl,
        notification_url: notificationUrl,
        credit_card: {
          token: paymentMethod.provider_token,
        },
        additional_data: {
          contract: ["recurring", "unscheduled"],
          order_id: order.id,
          payment_id: payment.id,
        },
      },
    };

    console.log('bePaid gateway URLs:', { origin, returnUrl, notificationUrl });

    console.log('Sending charge to bePaid Gateway:', JSON.stringify(chargePayload));

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

    // Log response status for debugging
    console.log(`bePaid charge response status: ${chargeResponse.status}`);
    
    const chargeResult = await chargeResponse.json();
    console.log('bePaid charge response:', JSON.stringify(chargeResult));

    // Handle non-200 responses from bePaid
    if (!chargeResponse.ok) {
      const errorMessage = chargeResult.message || chargeResult.error || `bePaid API error: ${chargeResponse.status}`;
      console.error('bePaid API error:', errorMessage, chargeResult);
      
      await supabase
        .from('payments_v2')
        .update({
          status: 'failed',
          error_message: errorMessage,
          provider_response: chargeResult,
        })
        .eq('id', payment.id);

      await supabase
        .from('orders_v2')
        .update({ status: 'failed' })
        .eq('id', order.id);

      return new Response(JSON.stringify({
        success: false,
        error: errorMessage,
        orderId: order.id,
        details: chargeResult,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const txStatus = chargeResult.transaction?.status;
    const txUid = chargeResult.transaction?.uid;
    const redirectUrl = chargeResult.transaction?.redirect_url;

    // 3-D Secure / additional verification required.
    // bePaid returns status=incomplete and provides redirect_url to complete the payment.
    if (txStatus === 'incomplete' && redirectUrl) {
      console.log('Transaction requires 3-D Secure verification, redirecting:', redirectUrl);

      // Persist provider details so the webhook can finalize the order later.
      await supabase
        .from('payments_v2')
        .update({
          status: 'processing',
          provider_payment_id: txUid || null,
          provider_response: chargeResult,
          error_message: chargeResult.transaction?.message || null,
        })
        .eq('id', payment.id);

      await supabase
        .from('orders_v2')
        .update({
          status: 'pending',
          meta: {
            ...(order.meta || {}),
            bepaid_uid: txUid,
            payment_id: payment.id,
            requires_3ds: true,
          },
        })
        .eq('id', order.id);

      return new Response(
        JSON.stringify({
          success: false,
          requiresRedirect: true,
          redirectUrl,
          orderId: order.id,
          paymentId: payment.id,
        }),
        {
          // Important: return 200 so the client does not treat this as a function error.
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (txStatus === 'successful') {
      // Update payment
      const { error: payUpdateError } = await supabase
        .from('payments_v2')
        .update({
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          provider_payment_id: chargeResult.transaction.uid,
          provider_response: chargeResult,
          card_last4: chargeResult.transaction.credit_card?.last_4 || paymentMethod.last4,
          card_brand: chargeResult.transaction.credit_card?.brand || paymentMethod.brand,
        })
        .eq('id', payment.id);

      if (payUpdateError) {
        console.error('Payment update error:', payUpdateError);
      }

      // Update order
      const { error: orderPaidError } = await supabase
        .from('orders_v2')
        .update({
          status: 'paid',
          paid_amount: amount,
          meta: {
            ...(order.meta || {}),
            bepaid_uid: txUid,
            payment_id: payment.id,
          },
        })
        .eq('id', order.id);

      if (orderPaidError) {
        console.error('Order paid update error:', orderPaidError);
      }

      // Create or update subscription
      const accessDays = isTrial ? effectiveTrialDays : tariff.access_days;
      // If extending existing subscription, start from its end date
      const baseDate = extendFromDate || new Date();
      const accessEndAt = new Date(baseDate.getTime() + accessDays * 24 * 60 * 60 * 1000);

      // Set next_charge_at only if this is a recurring subscription or trial with auto-charge
      let nextChargeAt: Date | null = null;
      if (isTrial && autoChargeAfterTrial) {
        nextChargeAt = new Date(accessEndAt.getTime() - 24 * 60 * 60 * 1000);
      } else if (!isTrial && isRecurringSubscription) {
        nextChargeAt = new Date(accessEndAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      }
      // If not recurring subscription (one-time payment), next_charge_at stays null

      let subscription;
      if (existingSub && !isTrial) {
        // Update existing subscription with extended access
        const { data: updatedSub, error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: accessEndAt.toISOString(),
            next_charge_at: nextChargeAt?.toISOString() || null,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSub.id)
          .select()
          .single();

        if (updateError) {
          console.error('Subscription update error:', updateError);
        }
        subscription = updatedSub;
        console.log(`Extended subscription ${existingSub.id} until ${accessEndAt.toISOString()}`);
      } else {
        // Create new subscription
        const { data: newSub, error: subError } = await supabase
          .from('subscriptions_v2')
          .insert({
            user_id: user.id,
            product_id: productId,
            tariff_id: tariff.id,
            order_id: order.id,
            status: isTrial ? 'trial' : 'active',
            is_trial: isTrial || false,
            access_start_at: new Date().toISOString(),
            access_end_at: accessEndAt.toISOString(),
            trial_end_at: isTrial ? accessEndAt.toISOString() : null,
            payment_method_id: paymentMethod.id,
            payment_token: paymentMethod.provider_token,
            next_charge_at: nextChargeAt?.toISOString() || null,
          })
          .select()
          .single();

        if (subError) {
          console.error('Subscription creation error:', subError);
        }
        subscription = newSub;
      }

      // Grant Telegram access
      if (product.telegram_club_id) {
        await supabase.functions.invoke('telegram-grant-access', {
          body: {
            user_id: user.id,
            duration_days: accessDays,
          },
        });
      }

      // GetCourse sync - prefer offer-level getcourse_offer_id, fallback to tariff-level
      const getcourseOfferId = offer?.getcourse_offer_id || tariff.getcourse_offer_id;
      if (getcourseOfferId) {
        console.log(`Syncing to GetCourse: offer_id=${getcourseOfferId}`);
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, phone')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (profile?.email) {
          const gcResult = await sendToGetCourse(
            profile.email,
            profile.phone || null,
            parseInt(getcourseOfferId, 10) || 0,
            order.order_number,
            amount,
            tariff.code || tariff.name
          );
          console.log('GetCourse sync result (direct-charge):', gcResult);
          
          // Save GetCourse sync result to order meta
          const existingMeta = (order as any).meta || {};
          await supabase
            .from('orders_v2')
            .update({
              meta: {
                ...existingMeta,
                bepaid_uid: txUid,
                payment_id: payment.id,
                gc_sync_status: gcResult.success ? 'success' : 'failed',
                gc_sync_error: gcResult.error || null,
                gc_order_id: gcResult.gcOrderId || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', order.id);
        }
      }

      // Audit log
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: isTrial ? 'subscription.trial_paid' : 'subscription.purchased',
        meta: {
          order_id: order.id,
          payment_id: payment.id,
          subscription_id: subscription?.id,
          amount,
          currency: product.currency,
          tariff_code: tariffCode,
          bepaid_uid: txUid,
        },
      });

      console.log(`Payment successful: ${payment.id}, subscription: ${subscription?.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          orderId: order.id,
          paymentId: payment.id,
          subscriptionId: subscription?.id,
          isTrial: isTrial || false,
          accessEndsAt: accessEndAt.toISOString(),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Treat all other statuses as failure (but respond with 200 so the UI doesn't blank-screen)
    const errorMessage =
      chargeResult.transaction?.message || chargeResult.errors?.base?.[0] || 'Payment failed';

    await supabase
      .from('payments_v2')
      .update({
        status: 'failed',
        error_message: errorMessage,
        provider_response: chargeResult,
        provider_payment_id: txUid || null,
      })
      .eq('id', payment.id);

    await supabase
      .from('orders_v2')
      .update({ status: 'failed' })
      .eq('id', order.id);

    console.error('Payment failed:', errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        orderId: order.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Direct charge error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
