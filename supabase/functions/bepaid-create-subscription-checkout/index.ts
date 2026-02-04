import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateSubscriptionCheckoutRequest {
  productId: string;
  tariffCode?: string;
  offerId?: string;
  customerEmail: string;
  customerPhone?: string;
  customerFirstName?: string;
  customerLastName?: string;
  existingUserId?: string;
}

interface BepaidConfig {
  shop_id: string;
  secret_key: string;
}

async function getBepaidCredentials(supabase: any): Promise<BepaidConfig | null> {
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;
  if (shopIdFromInstance && secretFromInstance) {
    console.log(`[bepaid-sub-checkout] Using creds from integration_instances`);
    return { shop_id: String(shopIdFromInstance), secret_key: String(secretFromInstance) };
  }

  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) {
    console.log(`[bepaid-sub-checkout] Using creds from env vars`);
    return { shop_id: shopId, secret_key: secretKey };
  }

  return null;
}

function generateOrderNumber(): string {
  const now = Date.now();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SUB-26-${now.toString(36).toUpperCase()}${random}`;
}

function safeParseFullName(fullName: string | null | undefined): { firstName: string | undefined; lastName: string | undefined } {
  if (!fullName?.trim()) return { firstName: undefined, lastName: undefined };
  
  const parts = fullName.trim().split(/\s+/);
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: undefined };
  }
  
  return {
    firstName: parts[0] || undefined,
    lastName: parts.slice(1).join(' ') || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: CreateSubscriptionCheckoutRequest = await req.json();
    const { productId, tariffCode, offerId, customerEmail, customerPhone, customerFirstName, customerLastName, existingUserId } = body;

    if (!productId || !customerEmail) {
      return new Response(JSON.stringify({ error: 'productId and customerEmail are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      console.error('[bepaid-sub-checkout] No bePaid credentials found');
      return new Response(JSON.stringify({ error: 'bePaid not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate shop ID
    if (credentials.shop_id !== '33524') {
      console.error('[bepaid-sub-checkout] Invalid shop_id:', credentials.shop_id);
      return new Response(JSON.stringify({ error: 'Invalid bePaid configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find or create user
    let userId = existingUserId;
    let profileId: string | null = null;

    if (!userId) {
      // PATCH-2: Use profiles table instead of listUsers() + handle email collisions
      const { data: profilesByEmail, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, id')
        .ilike('email', customerEmail.trim());

      if (profilesError) {
        console.error('[bepaid-sub-checkout] Profiles lookup failed:', profilesError);
        return new Response(JSON.stringify({ error: 'profiles lookup failed' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // PATCH-2: Email collision → 409 + stop (no auto-creation)
      if (profilesByEmail && profilesByEmail.length > 1) {
        console.error('[bepaid-sub-checkout] Multiple profiles found for email, stopping');
        return new Response(JSON.stringify({
          error: 'Multiple profiles found for this email. Please contact support.',
          code: 'EMAIL_COLLISION',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const profileByEmail = profilesByEmail?.[0] || null;

      if (profileByEmail?.user_id) {
        userId = profileByEmail.user_id;
        profileId = profileByEmail.id;
        console.log('[bepaid-sub-checkout] Found existing user via profiles');
      } else {
        // Create new user
        const tempPassword = Math.random().toString(36).slice(-12) + 'Aa1!';
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: customerEmail.toLowerCase().trim(),
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: `${customerFirstName || ''} ${customerLastName || ''}`.trim() || null,
            phone: customerPhone || null,
          },
        });

        if (createError) {
          console.error('[bepaid-sub-checkout] User creation error:', createError);
          return new Response(JSON.stringify({ error: 'Failed to create user' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        userId = newUser.user.id;
      }
    }

    // Get/create profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('user_id', userId)
      .maybeSingle();

    profileId = profile?.id || null;

    // Get product and tariff
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, name, code')
      .eq('id', productId)
      .single();

    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get tariff by code or first active for product
    let tariff: any = null;
    if (tariffCode) {
      const { data } = await supabase
        .from('tariffs')
        .select('id, name, code, access_days')
        .eq('product_id', productId)
        .eq('code', tariffCode)
        .eq('is_active', true)
        .maybeSingle();
      tariff = data;
    }
    
    if (!tariff) {
      const { data } = await supabase
        .from('tariffs')
        .select('id, name, code, access_days')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      tariff = data;
    }

    if (!tariff) {
      return new Response(JSON.stringify({ error: 'No active tariff found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get price
    let amountCents = 0;
    let currency = 'BYN';
    let intervalDays = 30;

    // Try offer first
    const effectiveOfferId = offerId;
    if (effectiveOfferId) {
      const { data: offerData } = await supabase
        .from('tariff_offers')
        .select('auto_charge_amount, amount, meta')
        .eq('id', effectiveOfferId)
        .maybeSingle();

      if (offerData) {
        const offerMeta = (offerData.meta || {}) as Record<string, any>;
        const recurringConfig = offerMeta.recurring || {};
        
        const amount = offerData.auto_charge_amount || offerData.amount;
        if (amount && Number(amount) > 0) {
          amountCents = Math.round(Number(amount) * 100);
        }
        
        if (recurringConfig.billing_period_mode === 'month') {
          intervalDays = 30;
        } else if (recurringConfig.billing_period_days) {
          intervalDays = Number(recurringConfig.billing_period_days);
        }
      }
    }

    // Fallback to tariff price
    if (!amountCents) {
      const { data: priceData } = await supabase
        .from('tariff_prices')
        .select('final_price, price')
        .eq('tariff_id', tariff.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priceData) {
        const price = priceData.final_price || priceData.price;
        amountCents = Math.round(Number(price) * 100);
      }
    }

    if (!amountCents || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'Could not determine subscription amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create order
    const orderNumber = generateOrderNumber();
    const amountMoney = amountCents / 100;
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .insert({
        user_id: userId,
        profile_id: profileId,
        product_id: productId,
        tariff_id: tariff.id,
        offer_id: effectiveOfferId || null,
        order_number: orderNumber,
        // NOT NULL fields required by schema
        base_price: amountMoney,
        final_price: amountMoney,
        is_trial: false,
        // paid_amount = 0 until webhook confirms payment
        paid_amount: 0,
        currency,
        status: 'pending',
        meta: {
          payment_flow: 'provider_managed_checkout',
          source: 'bepaid-create-subscription-checkout',
          expected_amount: amountMoney,
        },
      })
      .select('id')
      .single();

    if (orderError) {
      console.error('[bepaid-sub-checkout] Order creation error:', orderError);
      return new Response(JSON.stringify({ error: 'Failed to create order' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create subscription (pre-payment) with a valid enum status
    const accessDays = tariff.access_days || 30;
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .insert({
        user_id: userId,
        profile_id: profileId,
        product_id: productId,
        tariff_id: tariff.id,
        // subscription_status enum: active, trial, past_due, canceled, expired
        // Pre-payment state should NOT grant access; use past_due until webhook confirms payment.
        status: 'past_due',
        billing_type: 'provider_managed',
        auto_renew: true,
        is_trial: false,
        meta: {
          pending_provider_managed: true,
          checkout_order_id: order.id,
          offer_id: effectiveOfferId,
          access_days: accessDays, // Store in meta instead
        },
      })
      .select('id')
      .single();

    if (subError) {
      console.error('[bepaid-sub-checkout] Subscription creation error:', subError);
      return new Response(JSON.stringify({ error: 'Failed to create subscription' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare bePaid subscription request
    const baseUrl = 'https://club.gorbova.by/purchases';
    const trackingId = `subv2:${subscription.id}:order:${order.id}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
    const successReturnUrl = `${baseUrl}?bepaid_sub=success&sub_id=${subscription.id}&order=${order.id}`;

    // bePaid: language is passed under settings, and when creating a plan inline you must provide plan.shop_id.
    const bepaidPayload = {
      notification_url: notificationUrl,
      return_url: successReturnUrl,
      tracking_id: trackingId,
      customer: {
        email: customerEmail,
        first_name: customerFirstName || undefined,
        last_name: customerLastName || undefined,
      },
      plan: {
        shop_id: Number(credentials.shop_id),
        currency,
        title: `${product.name || 'Подписка'} — Каждые ${intervalDays} дней`,
        plan: {
          amount: amountCents,
          interval: intervalDays,
          interval_unit: 'day',
        },
      },
      settings: {
        language: 'ru',
      },
    };

    // PATCH-2: Log without PII
    console.log('[bepaid-sub-checkout] Creating bePaid subscription:', {
      subscription_v2_id: subscription.id,
      order_id: order.id,
      amount_cents: amountCents,
      interval_days: intervalDays,
    });

    const authString = btoa(`${credentials.shop_id}:${credentials.secret_key}`);
    const bepaidResponse = await fetch('https://api.bepaid.by/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(bepaidPayload),
    });

    const bepaidResult = await bepaidResponse.json();
    
    // PATCH-2: Log without PII - safe subset only
    console.log('[bepaid-sub-checkout] bePaid response:', {
      http_status: bepaidResponse.status,
      subscription_id: bepaidResult?.subscription?.id || bepaidResult?.id || null,
      has_redirect: !!(bepaidResult?.subscription?.checkout_url || bepaidResult?.subscription?.redirect_url),
    });

    if (!bepaidResponse.ok || bepaidResult.errors) {
      // PATCH-2: Log error status only, no PII
      console.error('[bepaid-sub-checkout] bePaid error: status=', bepaidResponse.status);
      // Update order status to failed
      await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', order.id);
      // subscription_status enum uses 'canceled' (one L)
      await supabase.from('subscriptions_v2').update({ status: 'canceled' }).eq('id', subscription.id);
      
      return new Response(JSON.stringify({ 
        error: 'Failed to create bePaid subscription',
        // PATCH-2: Don't expose raw bePaid response to client
      }), {
        status: bepaidResponse.status || 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bepaidSubscription = bepaidResult.subscription || bepaidResult;
    const bepaidSubId = bepaidSubscription.id;
    const redirectUrl = bepaidSubscription.checkout_url || bepaidSubscription.redirect_url;

    if (!bepaidSubId) {
      console.error('[bepaid-sub-checkout] No subscription ID in response');
      return new Response(JSON.stringify({ error: 'No subscription ID returned from bePaid' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create provider_subscriptions record
    // PATCH-2: Store safe subset only, no PII
    const { error: provSubError } = await supabase
      .from('provider_subscriptions')
      .upsert({
        provider: 'bepaid',
        provider_subscription_id: bepaidSubId,
        user_id: userId,
        subscription_v2_id: subscription.id,
        profile_id: profileId,
        state: 'pending',
        amount_cents: amountCents,
        currency,
        interval_days: intervalDays,
        raw_data: {
          subscription_id: bepaidSubId,
          state: bepaidSubscription.state,
          created_at: bepaidSubscription.created_at,
          checkout_url_present: !!redirectUrl,
        },
      }, { 
        onConflict: 'provider,provider_subscription_id',
        ignoreDuplicates: false 
      });

    if (provSubError) {
      console.error('[bepaid-sub-checkout] Failed to save provider_subscriptions:', provSubError);
    }

    // Update subscription meta with bePaid subscription ID
    await supabase
      .from('subscriptions_v2')
      .update({
        meta: {
          pending_provider_managed: true,
          checkout_order_id: order.id,
          offer_id: effectiveOfferId,
          bepaid_subscription_id: bepaidSubId,
          bepaid_subscription_created_at: new Date().toISOString(),
        },
      })
      .eq('id', subscription.id);

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-create-subscription-checkout',
      action: 'bepaid.subscription_checkout.create',
      target_user_id: userId,
      meta: {
        subscription_v2_id: subscription.id,
        order_id: order.id,
        bepaid_subscription_id: bepaidSubId,
        amount_cents: amountCents,
        currency,
        interval_days: intervalDays,
      },
    });

    console.log(`[bepaid-sub-checkout] Created subscription checkout for user ${userId}`);

    return new Response(JSON.stringify({
      success: true,
      bepaid_subscription_id: bepaidSubId,
      redirect_url: redirectUrl,
      order_id: order.id,
      subscription_id: subscription.id,
      amount: amountCents / 100,
      currency,
      interval_days: intervalDays,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[bepaid-sub-checkout] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
