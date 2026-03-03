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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // Auth guard
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7).trim();
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // RBAC: admin or super_admin
  const { data: isAdmin } = await supabaseAdmin.rpc('has_any_role', {
    p_user_id: userData.user.id,
    p_roles: ['admin', 'superadmin'],
  });

  if (!isAdmin) {
    return new Response(JSON.stringify({ success: false, error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { instance_id } = await req.json();
  if (!instance_id) {
    return new Response(JSON.stringify({ success: false, error: 'instance_id required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 1 test per 5 seconds per instance
  const { data: recentLogs } = await supabaseAdmin
    .from('integration_logs')
    .select('created_at')
    .eq('instance_id', instance_id)
    .eq('event_type', 'webhook_test')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (recentLogs) {
    const lastTest = new Date(recentLogs.created_at).getTime();
    if (Date.now() - lastTest < 5000) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit: подождите 5 секунд между тестами' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Get instance config (webhook_secret)
  const { data: instance, error: instErr } = await supabaseAdmin
    .from('integration_instances')
    .select('id, config, status')
    .eq('id', instance_id)
    .eq('provider', 'apix_instagram_dm')
    .single();

  if (instErr || !instance) {
    return new Response(JSON.stringify({ success: false, error: 'Integration instance not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const config = (instance.config || {}) as Record<string, any>;
  const webhookSecret = config.webhook_secret;
  if (!webhookSecret) {
    return new Response(JSON.stringify({ success: false, error: 'webhook_secret не настроен в конфигурации' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Call instagram-webhook with test payload
  const testPayload = {
    integration_instance_id: instance_id,
    external_message_id: `test:${Date.now()}`,
    sender_id: `test_probe_${Date.now()}`,
    sender_name: 'Webhook Test Probe',
    message_text: '[Тестовое сообщение для проверки webhook]',
    timestamp: new Date().toISOString(),
    _source: 'manual_test',
  };

  let webhookStatus = 0;
  let webhookBody = '';
  try {
    const webhookUrl = `${supabaseUrl}/functions/v1/instagram-webhook`;
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify(testPayload),
    });
    webhookStatus = resp.status;
    webhookBody = (await resp.text()).substring(0, 500);
  } catch (e) {
    webhookStatus = 0;
    webhookBody = e instanceof Error ? e.message : String(e);
  }

  // Log test result
  await supabaseAdmin.from('integration_logs').insert({
    instance_id,
    event_type: 'webhook_test',
    result: webhookStatus >= 200 && webhookStatus < 300 ? 'success' : 'error',
    error_message: webhookStatus >= 200 && webhookStatus < 300 ? null : `HTTP ${webhookStatus}: ${webhookBody}`,
    payload_meta: {
      provider: 'apix_instagram_dm',
      channel: 'instagram',
      source: 'manual_test',
      status_code: webhookStatus,
      response_preview: webhookBody.substring(0, 200),
      tested_by: userData.user.id,
    },
  });

  return new Response(JSON.stringify({
    success: webhookStatus >= 200 && webhookStatus < 300,
    status_code: webhookStatus,
    response: webhookBody,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
