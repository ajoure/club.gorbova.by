import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ status: 'auth_required' }, 401);
    }

    const jwtToken = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwtToken}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ status: 'auth_required' }, 401);
    }

    const body = await req.json();
    const { session_key } = body;

    if (!session_key || typeof session_key !== 'string') {
      return jsonResponse({ status: 'error', message: 'session_key required' }, 400);
    }

    // Find session — must match BOTH session_key AND user_id
    const { data: session, error: sessionErr } = await supabase
      .from('live_active_sessions')
      .select('id, user_id, live_event_id, revoked_at, expires_at')
      .eq('session_key', session_key)
      .eq('user_id', user.id)
      .maybeSingle();

    if (sessionErr || !session) {
      return jsonResponse({ status: 'session_not_found' }, 404);
    }

    // Check if revoked (displaced by another login)
    if (session.revoked_at) {
      return jsonResponse({ status: 'session_revoked' });
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      return jsonResponse({ status: 'session_expired' });
    }

    // Update last_seen_at
    await supabase
      .from('live_active_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.id);

    return jsonResponse({ status: 'ok' });
  } catch (err) {
    console.error('[live-session-heartbeat] Error:', err);
    return jsonResponse({ status: 'error', message: 'Internal error' }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
