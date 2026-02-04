import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CredentialsResult {
  shopId: string;
  secretKey: string;
}

async function getBepaidCredentials(supabase: any): Promise<CredentialsResult | null> {
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;
  if (shopIdFromInstance && secretFromInstance) {
    return { shopId: String(shopIdFromInstance), secretKey: String(secretFromInstance) };
  }

  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) {
    return { shopId, secretKey };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC: Only admin allowed
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

    const { data: hasAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    if (!hasAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subscription_id } = await req.json();
    if (!subscription_id) {
      return new Response(JSON.stringify({ error: 'subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      return new Response(JSON.stringify({ error: 'bePaid credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    // Fetch subscription details from bePaid
    const response = await fetch(`https://api.bepaid.by/subscriptions/${subscription_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[bepaid-get-subscription-details] bePaid error: ${response.status} ${text}`);
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch subscription from bePaid',
        status: response.status,
        details: text,
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const sub = data.subscription || data;

    // Build snapshot
    const snapshot = {
      id: sub.id,
      state: sub.state || sub.status,
      next_billing_at: sub.next_billing_at,
      last_payment_at: sub.last_payment_at,
      last_payment_status: sub.last_transaction?.status,
      last_payment_error: sub.last_transaction?.message,
      is_cancelable: sub.state !== 'cancelled' && sub.state !== 'canceled',
      plan: sub.plan,
      customer: sub.customer,
      credit_card: sub.credit_card,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
    };

    // Update provider_subscriptions with snapshot
    const { data: existingPs } = await supabase
      .from('provider_subscriptions')
      .select('meta')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', subscription_id)
      .maybeSingle();

    if (existingPs) {
      const newMeta = {
        ...(existingPs.meta || {}),
        provider_snapshot: snapshot,
        snapshot_at: new Date().toISOString(),
      };

      await supabase
        .from('provider_subscriptions')
        .update({ 
          state: snapshot.state,
          next_charge_at: snapshot.next_billing_at,
          meta: newMeta,
        })
        .eq('provider', 'bepaid')
        .eq('provider_subscription_id', subscription_id);
    }

    console.log(`[bepaid-get-subscription-details] Fetched snapshot for ${subscription_id}: state=${snapshot.state}`);

    return new Response(JSON.stringify({
      success: true,
      subscription_id,
      snapshot,
      is_cancelable: snapshot.is_cancelable,
      cancellation_capability: snapshot.is_cancelable ? 'can_cancel_now' : 'cannot_cancel_until_paid',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[bepaid-get-subscription-details] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
