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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
    
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

    const { data: hasAdminRole } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'admin' 
    });
    
    if (!hasAdminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!bepaidSecretKey) {
      return new Response(JSON.stringify({ error: 'BEPAID_SECRET_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const subscriptionIds: string[] = body.subscription_ids || [];
    
    if (!Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
      return new Response(JSON.stringify({ error: 'subscription_ids array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bepaidAuth = btoa(`${bepaidSecretKey}:`);
    const result: CancelResult = {
      cancelled: [],
      failed: [],
      total_requested: subscriptionIds.length,
    };

    // Cancel each subscription
    for (const subId of subscriptionIds) {
      try {
        const response = await fetch(
          `https://api.bepaid.by/subscriptions/${subId}/cancel`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${bepaidAuth}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          result.cancelled.push(subId);
          console.log(`Cancelled subscription ${subId}`);
          
          // Update our database if we have a linked subscription
          const { data: linkedSubs } = await supabase
            .from('subscriptions_v2')
            .select('id, meta')
            .eq('meta->bepaid_subscription_id', subId);
          
          for (const linked of linkedSubs || []) {
            await supabase
              .from('subscriptions_v2')
              .update({
                auto_renew: false,
                status: 'cancelled',
                canceled_at: new Date().toISOString(),
                meta: {
                  ...(linked.meta as object || {}),
                  bepaid_cancelled_at: new Date().toISOString(),
                  bepaid_cancelled_by: user.id,
                },
              })
              .eq('id', linked.id);
          }
        } else {
          const errText = await response.text();
          result.failed.push({ id: subId, error: `${response.status}: ${errText}` });
          console.error(`Failed to cancel ${subId}:`, response.status, errText);
        }
      } catch (e: any) {
        result.failed.push({ id: subId, error: e.message });
        console.error(`Error cancelling ${subId}:`, e);
      }
    }

    // Create audit log
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_subscriptions.bulk_cancel',
      actor_type: 'admin',
      meta: {
        requested: subscriptionIds.length,
        cancelled: result.cancelled.length,
        failed: result.failed.length,
        cancelled_ids: result.cancelled,
        failed_details: result.failed,
      },
    });

    console.log(`Cancel complete: ${result.cancelled.length}/${subscriptionIds.length} succeeded`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('Error cancelling subscriptions:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
