import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // PATCH-A: Superadmin-only (correct enum value: 'superadmin' without underscore)
    const { data: isSuperAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'superadmin',
    });

    if (isSuperAdmin !== true) {
      console.warn(`[admin-bepaid-emergency-unlink] Access denied for user ${user.id}`);
      return new Response(JSON.stringify({ error: 'Superadmin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { provider_subscription_id, confirm_text } = await req.json();

    // Validate confirm_text
    if (confirm_text !== 'UNLINK') {
      return new Response(JSON.stringify({ 
        error: 'Confirmation required: enter UNLINK' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!provider_subscription_id) {
      return new Response(JSON.stringify({ error: 'provider_subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing record for meta merge and target_user_id
    const { data: existing } = await supabase
      .from('provider_subscriptions')
      .select('user_id, meta, subscription_v2_id')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', provider_subscription_id)
      .maybeSingle();

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const before_subscription_v2_id = existing.subscription_v2_id ?? null;

    // Merge meta (safe, no PII in logs)
    const oldMeta = (existing.meta as Record<string, unknown>) || {};
    const newMeta = {
      ...oldMeta,
      emergency_unlink_at: new Date().toISOString(),
      emergency_unlink_reason: 'admin_emergency_unlink',
      emergency_unlink_initiator_user_id: user.id,
    };

    // Update provider_subscriptions
    const { error: updateError } = await supabase
      .from('provider_subscriptions')
      .update({ 
        subscription_v2_id: null,
        meta: newMeta,
      })
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', provider_subscription_id);

    if (updateError) {
      console.error('[admin-bepaid-emergency-unlink] Update error:', updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SYSTEM ACTOR audit log (no PII)
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-bepaid-emergency-unlink',
      action: 'bepaid.subscription.emergency_unlink',
      target_user_id: existing.user_id,
      meta: {
        provider_subscription_id,
        confirmed_with: 'UNLINK',
        initiator_user_id: user.id,
        before_subscription_v2_id,
      },
    });

    console.log(`[admin-bepaid-emergency-unlink] Unlinked ${provider_subscription_id} by initiator=${user.id}`);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Subscription unlinked',
      provider_subscription_id,
      target_user_id: existing.user_id,
      before_subscription_v2_id,
      after_subscription_v2_id: null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[admin-bepaid-emergency-unlink] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
