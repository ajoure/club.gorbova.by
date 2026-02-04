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

    // RBAC: Check roles
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

    // Check super_admin role
    const { data: hasSuperAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'super_admin',
    });

    const { data: hasAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    // Must have at least admin to access
    if (!hasSuperAdmin && !hasAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(body.limit || 500, 1000); // max 1000

    // PATCH-E: super_admin required for execute mode
    if (!dryRun && !hasSuperAdmin) {
      return new Response(JSON.stringify({ 
        error: 'Super admin access required for execute mode',
        dry_run_allowed: true 
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const reconcileRunId = crypto.randomUUID();

    console.log(`[admin-reconcile-bepaid-legacy] Starting reconcile: dry_run=${dryRun}, limit=${limit}, run_id=${reconcileRunId}`);

    // Call the RPC function
    const { data, error } = await supabase.rpc('admin_reconcile_bepaid_legacy_subscriptions', {
      p_dry_run: dryRun,
      p_limit: limit,
      p_reconcile_run_id: reconcileRunId,
    });

    if (error) {
      console.error('[admin-reconcile-bepaid-legacy] RPC error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[admin-reconcile-bepaid-legacy] Result:', JSON.stringify(data));

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[admin-reconcile-bepaid-legacy] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
