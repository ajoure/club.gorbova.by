import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateSubscriptionRequest {
  subscription_v2_id: string;
  offer_id?: string;
  return_url?: string;
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
    console.log(`[bepaid-create-sub] Using creds from integration_instances`);
    return { shop_id: String(shopIdFromInstance), secret_key: String(secretFromInstance) };
  }

  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) {
    console.log(`[bepaid-create-sub] Using creds from env vars`);
    return { shop_id: shopId, secret_key: secretKey };
  }

  return null;
}

// PATCH-3: Safe name parsing - handles 0/1/2/3+ tokens correctly
function safeParseFullName(fullName: string | null | undefined): { firstName: string | undefined; lastName: string | undefined } {
  if (!fullName?.trim()) return { firstName: undefined, lastName: undefined };
  
  const parts = fullName.trim().split(/\s+/);
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: undefined };
  }
  
  // Standard format: first token is first name, rest is last name
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

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: CreateSubscriptionRequest = await req.json();
    const { subscription_v2_id, offer_id, return_url } = body;

    if (!subscription_v2_id) {
      return new Response(JSON.stringify({ error: 'subscription_v2_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch subscription with related data
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        products_v2(id, name, code),
        tariffs(id, name, code, access_days),
        profiles!subscriptions_v2_user_id_fkey(id, email, full_name)
      `)
      .eq('id', subscription_v2_id)
      .single();

    if (subError || !subscription) {
      console.error('[bepaid-create-sub] Subscription not found:', subError);
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // RBAC: User can only create provider subscription for their own subscription
    if (subscription.user_id !== user.id) {
      console.error('[bepaid-create-sub] User does not own subscription');
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if already provider_managed
    if (subscription.billing_type === 'provider_managed') {
      // Check if there's an active provider subscription
      const { data: existingProvSub } = await supabase
        .from('provider_subscriptions')
        .select('id, state, provider_subscription_id')
        .eq('subscription_v2_id', subscription_v2_id)
        .in('state', ['active', 'pending', 'trial'])
        .maybeSingle();

      if (existingProvSub) {
        return new Response(JSON.stringify({ 
          error: 'Already has active provider subscription',
          provider_subscription_id: existingProvSub.provider_subscription_id 
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      console.error('[bepaid-create-sub] No bePaid credentials found');
      return new Response(JSON.stringify({ error: 'bePaid not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get recurring settings
    const subMeta = (subscription.meta || {}) as Record<string, any>;
    let intervalDays = 30;
    let amountCents = 0;
    let currency = 'BYN';

    // Try to get settings from tariff_offers
    const effectiveOfferId = offer_id || subMeta.offer_id;
    if (effectiveOfferId) {
      const { data: offerData } = await supabase
        .from('tariff_offers')
        .select('auto_charge_amount, amount, meta')
        .eq('id', effectiveOfferId)
        .maybeSingle();

      if (offerData) {
        const offerMeta = (offerData.meta || {}) as Record<string, any>;
        const recurringConfig = offerMeta.recurring || {};
        
        // Amount priority: auto_charge_amount > offer amount
        const amount = offerData.auto_charge_amount || offerData.amount;
        if (amount && Number(amount) > 0) {
          amountCents = Math.round(Number(amount) * 100);
        }
        
        // Interval from recurring config
        if (recurringConfig.billing_period_mode === 'month') {
          intervalDays = 30;
        } else if (recurringConfig.billing_period_days) {
          intervalDays = Number(recurringConfig.billing_period_days);
        }
      }
    }

    // Fallback to subscription meta
    if (!amountCents && subMeta.recurring_amount) {
      amountCents = Math.round(Number(subMeta.recurring_amount) * 100);
    }

    // Final fallback to tariff price
    if (!amountCents && subscription.tariff_id) {
      const { data: priceData } = await supabase
        .from('tariff_prices')
        .select('final_price, price')
        .eq('tariff_id', subscription.tariff_id)
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

    // Get profile info for customer data
    const profile = subscription.profiles || {};
    const product = subscription.products_v2 || {};
    const tariff = subscription.tariffs || {};

    // Get user email
    let customerEmail = profile.email;
    if (!customerEmail) {
      const { data: authUser } = await supabase.auth.admin.getUserById(user.id);
      customerEmail = authUser?.user?.email;
    }

    // Build bePaid subscription request
    const baseUrl = return_url?.split('?')[0] || 'https://club.gorbova.by/settings/payment-methods';
    const trackingId = `subv2:${subscription_v2_id}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
    const successReturnUrl = `${baseUrl}?bepaid_sub=success&sub_id=${subscription_v2_id}`;
    const failReturnUrl = `${baseUrl}?bepaid_sub=failed&sub_id=${subscription_v2_id}`;

    // PATCH-3: Use safe name parsing
    const parsedName = safeParseFullName(profile.full_name);

    const bepaidPayload = {
      subscription: {
        notification_url: notificationUrl,
        return_url: successReturnUrl,
        decline_url: failReturnUrl,
        tracking_id: trackingId,
        language: 'ru',
        customer: {
          email: customerEmail,
          first_name: parsedName.firstName,
          last_name: parsedName.lastName,
        },
        plan: {
          currency,
          title: `${product.name || 'Подписка'} — Каждые ${intervalDays} дней`,
          plan: {
            amount: amountCents,
            interval: intervalDays,
            interval_unit: 'day',
          },
        },
      },
    };

    // PATCH-2: NO PII logging - only safe fields
    console.log('[bepaid-create-sub] Creating bePaid subscription:', {
      subscription_v2_id,
      amount_cents: amountCents,
      currency,
      interval_days: intervalDays,
      product_id: product?.id,
      tracking_id: trackingId,
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
    
    // PATCH-2: NO PII logging - only safe fields from response
    console.log('[bepaid-create-sub] bePaid response:', {
      status: bepaidResponse.status,
      bepaid_subscription_id: bepaidResult?.subscription?.id || bepaidResult?.id || null,
      has_redirect_url: !!(bepaidResult?.subscription?.checkout_url || bepaidResult?.subscription?.redirect_url),
    });

    if (!bepaidResponse.ok || bepaidResult.errors) {
      console.error('[bepaid-create-sub] bePaid error:', bepaidResult);
      return new Response(JSON.stringify({ 
        error: 'Failed to create bePaid subscription',
        details: bepaidResult.errors || bepaidResult 
      }), {
        status: bepaidResponse.status || 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bepaidSubscription = bepaidResult.subscription || bepaidResult;
    const bepaidSubId = bepaidSubscription.id;
    const redirectUrl = bepaidSubscription.checkout_url || bepaidSubscription.redirect_url;

    if (!bepaidSubId) {
      console.error('[bepaid-create-sub] No subscription ID in response');
      return new Response(JSON.stringify({ error: 'No subscription ID returned from bePaid' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert provider_subscriptions
    const { error: provSubError } = await supabase
      .from('provider_subscriptions')
      .upsert({
        provider: 'bepaid',
        provider_subscription_id: bepaidSubId,
        user_id: user.id,
        subscription_v2_id: subscription_v2_id,
        profile_id: profile.id || null,
        state: 'pending',
        amount_cents: amountCents,
        currency,
        interval_days: intervalDays,
        raw_data: bepaidResult,
      }, { 
        onConflict: 'provider,provider_subscription_id',
        ignoreDuplicates: false 
      });

    if (provSubError) {
      console.error('[bepaid-create-sub] Failed to save provider_subscriptions:', provSubError);
      // Don't fail - subscription was created in bePaid
    }

    // Update subscriptions_v2
    const { error: updateSubError } = await supabase
      .from('subscriptions_v2')
      .update({
        billing_type: 'provider_managed',
        meta: {
          ...subMeta,
          bepaid_subscription_id: bepaidSubId,
          bepaid_subscription_created_at: new Date().toISOString(),
        },
      })
      .eq('id', subscription_v2_id);

    if (updateSubError) {
      console.error('[bepaid-create-sub] Failed to update subscription:', updateSubError);
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-create-subscription',
      action: 'bepaid.subscription.create',
      target_user_id: user.id,
      meta: {
        subscription_v2_id,
        bepaid_subscription_id: bepaidSubId,
        amount_cents: amountCents,
        currency,
        interval_days: intervalDays,
        initiator_user_id: user.id,
      },
    });

    console.log(`[bepaid-create-sub] Created subscription ${bepaidSubId} for user ${user.id}`);

    return new Response(JSON.stringify({
      success: true,
      bepaid_subscription_id: bepaidSubId,
      redirect_url: redirectUrl,
      amount: amountCents / 100,
      currency,
      interval_days: intervalDays,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[bepaid-create-sub] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
