// TEMPORARY smoke harness for audit-shape. Calls telegram-webhook server-to-server
// using AUDIT_SHAPE_SECRET from env, then returns the response. Requires CRON_SECRET
// header to authorize the smoke run itself.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const auditSecret = Deno.env.get('AUDIT_SHAPE_SECRET') || '';
  if (!auditSecret) {
    return new Response(JSON.stringify({ error: 'no_audit_shape_secret_in_env' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'valid'; // valid | no_meta | bad_secret
  const botId = url.searchParams.get('bot_id') || '';

  const body: any = {
    update_id: 999000002,
    chat_join_request: {
      chat: { id: -1009999999999, type: 'channel', title: 'audit-shape-test' },
      from: { id: 987654321, first_name: 'Shape' },
      user_chat_id: 987654321,
      date: 1700000000,
    },
  };
  if (mode !== 'no_meta') {
    body._audit_shape_meta = { scenario: 'INVITE_USED', actor_user_id: '00000000-0000-0000-0000-000000000000' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'bad_secret') headers['x-audit-shape-secret'] = '__WRONG__';
  else headers['x-audit-shape-secret'] = auditSecret;

  const target = `${supabaseUrl}/functions/v1/telegram-webhook?bot_id=${encodeURIComponent(botId)}`;
  const resp = await fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return new Response(JSON.stringify({
    mode,
    status: resp.status,
    body: text,
    secret_present: auditSecret.length > 0,
    secret_length: auditSecret.length,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
