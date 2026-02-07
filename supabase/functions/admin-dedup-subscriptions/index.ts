import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC: Only admin/superadmin allowed
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

    // Check admin or superadmin role
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

    // Parse request body
    const { mode = 'dry-run' } = await req.json();

    // Validate mode
    if (mode !== 'dry-run' && mode !== 'execute') {
      return new Response(JSON.stringify({ error: 'Invalid mode. Use "dry-run" or "execute"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // STOP-guard: For execute mode, require explicit confirmation
    if (mode === 'execute') {
      // First run dry-run to count affected records
      const { data: dryRunResult, error: dryRunError } = await supabase.rpc(
        'admin_dedup_bepaid_subscriptions',
        { p_mode: 'dry-run' }
      );

      if (dryRunError) {
        console.error('[admin-dedup-subscriptions] Dry-run error:', dryRunError);
        return new Response(JSON.stringify({ error: dryRunError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Batch limit: max 50 records per execute
      const foundCount = dryRunResult?.found_count || 0;
      if (foundCount > 50) {
        console.log(`[admin-dedup-subscriptions] STOP-guard: ${foundCount} records exceed limit of 50`);
        return new Response(JSON.stringify({
          status: 'STOP',
          reason: `Found ${foundCount} duplicates, exceeds batch limit of 50. Process in smaller batches.`,
          found_count: foundCount,
          duplicates: dryRunResult.duplicates,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Call the RPC function
    const { data: result, error: rpcError } = await supabase.rpc(
      'admin_dedup_bepaid_subscriptions',
      { p_mode: mode }
    );

    if (rpcError) {
      console.error('[admin-dedup-subscriptions] RPC error:', rpcError);
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[admin-dedup-subscriptions] ${mode}: found=${result?.found_count}, processed=${result?.processed_count}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[admin-dedup-subscriptions] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
