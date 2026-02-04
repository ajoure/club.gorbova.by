import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CredentialsResult {
  shopId: string;
  secretKey: string;
}

// PATCH-H: Centralized status normalization
function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  // cancelled → canceled
  if (status === 'cancelled') return 'canceled';
  return status;
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

    // PATCH-A: Check both admin and superadmin (correct enum values)
    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);

    const isAdmin = hasAdmin === true || hasSuperAdmin === true;
    if (!isAdmin) {
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

    // PATCH-C/H: Normalize state
    const normalizedState = normalizeStatus(sub.state || sub.status);

    // Build snapshot
    const snapshot = {
      id: sub.id,
      state: normalizedState,  // Normalized
      raw_state: sub.state || sub.status,  // Original for debugging
      next_billing_at: sub.next_billing_at,
      last_payment_at: sub.last_payment_at,
      last_payment_status: sub.last_transaction?.status,
      last_payment_error: sub.last_transaction?.message,
      // PATCH-C: For canceled/terminated - is_cancelable = false (already done)
      is_cancelable: normalizedState !== 'canceled' && normalizedState !== 'terminated',
      plan: sub.plan,
      customer: sub.customer,
      credit_card: sub.credit_card,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
    };

    // PATCH-C: Determine cancellation_capability correctly
    // - For canceled/terminated: not_applicable (already canceled)
    // - For active/trial: can_cancel_now
    // - For past_due or unknown: unknown (we don't assume cannot_cancel_until_paid without API evidence)
    let cancellation_capability: 'can_cancel_now' | 'cannot_cancel_until_paid' | 'unknown' | 'not_applicable' = 'unknown';

    if (normalizedState === 'canceled' || normalizedState === 'terminated') {
      cancellation_capability = 'not_applicable';  // Already canceled
    } else if (normalizedState === 'active' || normalizedState === 'trial') {
      cancellation_capability = 'can_cancel_now';
    }
    // For past_due, unknown, etc. - we keep 'unknown' and do NOT assume 'cannot_cancel_until_paid'

    // PATCH-C: Atomic meta update using read-modify-write
    const { data: existingPs } = await supabase
      .from('provider_subscriptions')
      .select('meta')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', subscription_id)
      .maybeSingle();

    if (existingPs) {
      // Merge old meta with new snapshot
      const oldMeta = (existingPs.meta as Record<string, unknown>) || {};
      const newMeta = {
        ...oldMeta,
        provider_snapshot: snapshot,
        snapshot_at: new Date().toISOString(),
        cancellation_capability,
      };

      // Single update with merged meta
      const { error: updateError } = await supabase
        .from('provider_subscriptions')
        .update({ 
          state: normalizedState,  // Use normalized state
          next_charge_at: snapshot.next_billing_at,
          meta: newMeta,
        })
        .eq('provider', 'bepaid')
        .eq('provider_subscription_id', subscription_id);

      if (updateError) {
        console.error(`[bepaid-get-subscription-details] Update error:`, updateError);
      }
    }

    console.log(`[bepaid-get-subscription-details] Fetched snapshot for ${subscription_id}: state=${normalizedState}, capability=${cancellation_capability}`);

    return new Response(JSON.stringify({
      success: true,
      subscription_id,
      snapshot,
      is_cancelable: snapshot.is_cancelable,
      cancellation_capability,
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
