const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeployLogPayload {
  run_id: string;
  commit_sha: string;
  run_number?: number;
  deployed_functions: string[];
  failed_functions?: string[];
  status: 'in_progress' | 'completed' | 'failed';
  started_at?: string;
  finished_at?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // AUTH: Validate X-Cron-Secret header
    const cronSecret = Deno.env.get('CRON_SECRET');
    const providedSecret = req.headers.get('X-Cron-Secret') || req.headers.get('x-cron-secret');
    
    if (!cronSecret || providedSecret !== cronSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: invalid or missing X-Cron-Secret' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse payload
    const payload: DeployLogPayload = await req.json();
    
    // Validate required fields
    if (!payload.run_id || !payload.commit_sha || !payload.status) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: run_id, commit_sha, status' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase admin client (uses SUPABASE_SERVICE_ROLE_KEY internally)
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Calculate duration if both timestamps provided
    let duration_ms: number | null = null;
    if (payload.started_at && payload.finished_at) {
      const start = new Date(payload.started_at).getTime();
      const end = new Date(payload.finished_at).getTime();
      if (!isNaN(start) && !isNaN(end)) {
        duration_ms = end - start;
      }
    }

    // Insert deploy log
    const { data, error } = await supabaseAdmin
      .from('deploy_logs')
      .insert({
        run_id: payload.run_id,
        commit_sha: payload.commit_sha,
        run_number: payload.run_number || null,
        deployed_functions: payload.deployed_functions || [],
        failed_functions: payload.failed_functions || [],
        status: payload.status,
        started_at: payload.started_at || new Date().toISOString(),
        finished_at: payload.finished_at || null,
        duration_ms,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to insert deploy log:', error);
      return new Response(
        JSON.stringify({ error: `DB error: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deploy log recorded:', data.id);
    
    return new Response(
      JSON.stringify({ success: true, id: data.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('log-deployment error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
