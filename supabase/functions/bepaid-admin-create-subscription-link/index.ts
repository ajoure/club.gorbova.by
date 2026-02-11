import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateLinkRequest {
  subscription_v2_id: string;
}

// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

// Safe name parsing - handles 0/1/2/3+ tokens correctly
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

    // Auth check - get admin user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !adminUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // RBAC: Check admin access using has_role with 'admin' role
    const { data: isAdmin, error: rbacError } = await supabase
      .rpc('has_role', { _user_id: adminUser.id, _role: 'admin' });

    // Fallback: also check super_admin
    const { data: isSuperAdmin } = await supabase
      .rpc('is_super_admin', { _user_id: adminUser.id });

    if (rbacError || (!isAdmin && !isSuperAdmin)) {
      console.error('[bepaid-admin-link] RBAC check failed:', { admin_id: adminUser.id, isAdmin, isSuperAdmin, error: rbacError });
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: CreateLinkRequest = await req.json();
    const { subscription_v2_id } = body;

    if (!subscription_v2_id) {
      return new Response(JSON.stringify({ error: 'subscription_v2_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load subscription (NO ownership check - admin can access any)
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        products_v2(id, name, code),
        tariffs(id, name, code, access_days)
      `)
      .eq('id', subscription_v2_id)
      .single();

    if (subError || !subscription) {
      console.error('[bepaid-admin-link] Subscription not found:', { subscription_v2_id });
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate subscription status
    if (!['active', 'trial'].includes(subscription.status)) {
      return new Response(JSON.stringify({ error: 'Subscription must be active or trial' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for existing provider subscription
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

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error('[bepaid-admin-link] No bePaid credentials found:', credsResult.error);
      return new Response(JSON.stringify({ error: credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;

    // Get recurring settings from tariff_offers or subscription meta
    const subMeta = (subscription.meta || {}) as Record<string, any>;
    let intervalDays = 30;
    let amountCents = 0;
    const currency = 'BYN';

    console.log('[bepaid-admin-link] subMeta:', { 
      offer_id: subMeta.offer_id, 
      recurring_amount: subMeta.recurring_amount,
      has_recurring_snapshot: !!subMeta.recurring_snapshot
    });

    const effectiveOfferId = subMeta.offer_id;
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

    // Get owner profile info (NOT admin) - separate query since no FK
    const ownerId = subscription.user_id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('user_id', ownerId)
      .maybeSingle();
    
    const product = subscription.products_v2 || {};

    // Get owner email - fallback to auth.users
    let customerEmail = profile?.email;
    if (!customerEmail) {
      const { data: authUser } = await supabase.auth.admin.getUserById(ownerId);
      customerEmail = authUser?.user?.email;
    }

    // Build bePaid subscription request
    const baseUrl = 'https://club.gorbova.by/settings/payment-methods';
    const trackingId = `subv2:${subscription_v2_id}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
    const successReturnUrl = `${baseUrl}?bepaid_sub=success&sub_id=${subscription_v2_id}`;
    const failReturnUrl = `${baseUrl}?bepaid_sub=failed&sub_id=${subscription_v2_id}`;

    const parsedName = safeParseFullName(profile?.full_name);

    const bepaidPayload = {
      notification_url: notificationUrl,
      return_url: successReturnUrl,
      decline_url: failReturnUrl,
      tracking_id: trackingId,
      settings: {
        language: 'ru',
      },
      customer: {
        email: customerEmail,
        first_name: parsedName.firstName,
        last_name: parsedName.lastName,
        ip: '127.0.0.1', // Admin-initiated, no real client IP available
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
    };

    // NO PII logging - only safe fields
    console.log('[bepaid-admin-link] Creating bePaid subscription:', {
      subscription_v2_id,
      owner_id: ownerId,
      admin_id: adminUser.id,
      amount_cents: amountCents,
      currency,
      interval_days: intervalDays,
      product_id: product?.id,
    });

    // PATCH-P0.9.1: Strict auth + marker
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-admin-link',
      action: 'bepaid.request.attempt',
      meta: {
        fn: 'bepaid-admin-create-subscription-link',
        endpoint: '/subscriptions',
        shop_id_last4: bepaidCreds.shop_id.slice(-4),
        test_mode: bepaidCreds.test_mode,
        provider: 'bepaid'
      }
    });

    const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
    const bepaidResponse = await fetch('https://api.bepaid.by/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': bepaidAuth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(bepaidPayload),
    });

    const bepaidResult = await bepaidResponse.json();
    
    console.log('[bepaid-admin-link] bePaid response:', {
      status: bepaidResponse.status,
      bepaid_subscription_id: bepaidResult?.subscription?.id || bepaidResult?.id || null,
      has_redirect_url: !!(bepaidResult?.subscription?.checkout_url || bepaidResult?.subscription?.redirect_url),
    });

    if (!bepaidResponse.ok || bepaidResult.errors) {
      console.error('[bepaid-admin-link] bePaid error:', {
        http_status: bepaidResponse.status,
        has_errors: !!bepaidResult?.errors,
      });
      return new Response(JSON.stringify({ 
        error: 'Failed to create bePaid subscription'
      }), {
        status: bepaidResponse.status || 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bepaidSubscription = bepaidResult.subscription || bepaidResult;
    const bepaidSubId = bepaidSubscription.id;
    const redirectUrl = bepaidSubscription.checkout_url || bepaidSubscription.redirect_url;

    if (!bepaidSubId) {
      console.error('[bepaid-admin-link] No subscription ID in response');
      return new Response(JSON.stringify({ error: 'No subscription ID returned from bePaid' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert provider_subscriptions with OWNER user_id (not admin)
    const { error: provSubError } = await supabase
      .from('provider_subscriptions')
      .upsert({
        provider: 'bepaid',
        provider_subscription_id: bepaidSubId,
        user_id: ownerId, // CRITICAL: Owner, not admin!
        subscription_v2_id: subscription_v2_id,
        profile_id: profile?.id || null,
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
      console.error('[bepaid-admin-link] Failed to save provider_subscriptions:', provSubError);
    }

    // Update subscriptions_v2 meta ONLY (billing_type changes on webhook/success confirmation)
    const { error: updateSubError } = await supabase
      .from('subscriptions_v2')
      .update({
        meta: {
          ...subMeta,
          bepaid_subscription_id: bepaidSubId,
          bepaid_link_created_at: new Date().toISOString(),
          admin_created_link: true,
        },
      })
      .eq('id', subscription_v2_id);

    if (updateSubError) {
      console.error('[bepaid-admin-link] Failed to update subscription meta:', { error_code: updateSubError.code });
    }

    // SYSTEM ACTOR Audit log - as required by DoD
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-admin-create-subscription-link',
      action: 'bepaid.subscription.create_link',
      target_user_id: ownerId,
      meta: {
        admin_user_id: adminUser.id,
        subscription_v2_id,
        bepaid_subscription_id: bepaidSubId,
        amount_cents: amountCents,
        currency,
        interval_days: intervalDays,
        initiated_by_admin: true,
      },
    });

    console.log(`[bepaid-admin-link] Created subscription ${bepaidSubId} for owner ${ownerId} by admin ${adminUser.id}`);

    return new Response(JSON.stringify({
      success: true,
      redirect_url: redirectUrl,
      subscription_v2_id,
      bepaid_subscription_id: bepaidSubId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[bepaid-admin-link] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
