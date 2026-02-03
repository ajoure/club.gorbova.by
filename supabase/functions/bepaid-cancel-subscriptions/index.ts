import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CancelResult {
  cancelled: string[];
  failed: Array<{ id: string; error: string }>;
  total_requested: number;
}

interface CancelRequest {
  subscription_ids?: string[];           // bePaid subscription IDs
  provider_subscription_ids?: string[];  // Alias for subscription_ids
  subscription_v2_id?: string;           // Our subscription ID - will find and cancel linked provider sub
  source?: string;                       // 'user_self_cancel' | 'admin_cancel'
}

async function getBepaidCredentials(supabase: any): Promise<{ shopId: string; secretKey: string } | null> {
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;
  if (shopIdFromInstance && secretFromInstance) {
    console.log(`[bepaid-cancel-subs] Using creds from integration_instances: shop_id=${shopIdFromInstance}`);
    return { shopId: String(shopIdFromInstance), secretKey: String(secretFromInstance) };
  }

  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) {
    console.log(`[bepaid-cancel-subs] Using creds from env vars: shop_id=${shopId}`);
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

    // Check if user is admin
    const { data: hasAdminRole } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    const body: CancelRequest = await req.json();
    const source = body.source || (hasAdminRole ? 'admin_cancel' : 'user_self_cancel');
    
    // Collect subscription IDs to cancel
    let subscriptionIds: string[] = [];
    let targetUserId: string | null = null;

    // Option 1: Direct bePaid subscription IDs
    if (body.subscription_ids?.length) {
      subscriptionIds = body.subscription_ids;
    } else if (body.provider_subscription_ids?.length) {
      subscriptionIds = body.provider_subscription_ids;
    }
    
    // Option 2: Find by subscription_v2_id
    if (body.subscription_v2_id) {
      const { data: provSubs } = await supabase
        .from('provider_subscriptions')
        .select('provider_subscription_id, user_id')
        .eq('subscription_v2_id', body.subscription_v2_id)
        .in('state', ['active', 'pending', 'trial']);

      if (provSubs?.length) {
        subscriptionIds.push(...provSubs.map((s: any) => s.provider_subscription_id));
        targetUserId = provSubs[0].user_id;
      }
    }

    if (subscriptionIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No subscription IDs provided or found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // RBAC: Non-admins can only cancel their own subscriptions
    if (!hasAdminRole) {
      // Verify ownership of all subscriptions
      const { data: ownedSubs } = await supabase
        .from('provider_subscriptions')
        .select('provider_subscription_id')
        .in('provider_subscription_id', subscriptionIds)
        .eq('user_id', user.id);

      const ownedIds = new Set(ownedSubs?.map((s: any) => s.provider_subscription_id) || []);
      const notOwnedIds = subscriptionIds.filter(id => !ownedIds.has(id));

      if (notOwnedIds.length > 0) {
        console.error(`[bepaid-cancel-subs] User ${user.id} tried to cancel unowned subscriptions:`, notOwnedIds);
        return new Response(JSON.stringify({ 
          error: 'Access denied: Cannot cancel subscriptions you do not own' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      console.error('[bepaid-cancel-subs] No credentials found');
      return new Response(JSON.stringify({ 
        error: 'bePaid credentials not configured',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    const result: CancelResult = {
      cancelled: [],
      failed: [],
      total_requested: subscriptionIds.length,
    };

    for (const subId of subscriptionIds) {
      try {
        // Call bePaid cancel API
        const response = await fetch(`https://api.bepaid.by/subscriptions/${subId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authString}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ cancel_reason: source === 'user_self_cancel' ? 'cancelled_by_customer' : 'cancelled_by_admin' }),
        });

        if (response.ok || response.status === 404) {
          // 404 means already canceled - treat as success
          result.cancelled.push(subId);
          console.log(`[bepaid-cancel-subs] Cancelled subscription ${subId}`);

          // Update provider_subscriptions
          await supabase
            .from('provider_subscriptions')
            .update({
              state: 'canceled',
            })
            .eq('provider_subscription_id', subId);

          // Update linked subscriptions_v2
          const { data: linkedSubs } = await supabase
            .from('provider_subscriptions')
            .select('subscription_v2_id, user_id')
            .eq('provider_subscription_id', subId);

          for (const linked of linkedSubs || []) {
            if (linked.subscription_v2_id) {
              const { data: subV2 } = await supabase
                .from('subscriptions_v2')
                .select('meta')
                .eq('id', linked.subscription_v2_id)
                .single();

              await supabase
                .from('subscriptions_v2')
                .update({
                  auto_renew: false,
                  canceled_at: new Date().toISOString(),
                  meta: {
                    ...((subV2?.meta as object) || {}),
                    bepaid_cancelled_at: new Date().toISOString(),
                    bepaid_cancelled_by: user.id,
                    bepaid_cancel_source: source,
                  },
                })
                .eq('id', linked.subscription_v2_id);
            }

            // Set targetUserId for audit
            if (!targetUserId && linked.user_id) {
              targetUserId = linked.user_id;
            }
          }
        } else {
          const errText = await response.text();
          result.failed.push({ id: subId, error: `${response.status}: ${errText}` });
          console.error(`[bepaid-cancel-subs] Failed to cancel ${subId}:`, response.status, errText);
        }
      } catch (e: any) {
        result.failed.push({ id: subId, error: e.message });
        console.error(`[bepaid-cancel-subs] Error cancelling ${subId}:`, e);
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-cancel-subscription',
      action: 'bepaid.subscription.cancel',
      target_user_id: targetUserId || user.id,
      meta: {
        requested: subscriptionIds.length,
        cancelled: result.cancelled.length,
        failed: result.failed.length,
        cancelled_ids: result.cancelled,
        failed_details: result.failed,
        source,
        initiator_user_id: user.id,
        is_admin: hasAdminRole,
      },
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[bepaid-cancel-subs] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
