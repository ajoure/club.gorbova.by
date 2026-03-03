import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PAYLOAD_SIZE = 1024 * 256; // 256KB

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: any;
  try {
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > MAX_PAYLOAD_SIZE) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Determine integration_instance_id from body or query
  const instanceId = body.integration_instance_id;
  if (!instanceId) {
    return new Response(JSON.stringify({ error: 'Missing integration_instance_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup integration instance and validate webhook_secret
  const { data: instance, error: instanceErr } = await supabase
    .from('integration_instances')
    .select('id, config, status')
    .eq('id', instanceId)
    .eq('provider', 'apix_instagram_dm')
    .single();

  if (instanceErr || !instance) {
    // Log error
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Integration instance not found', body);
    return new Response(JSON.stringify({ error: 'Integration not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate webhook secret
  const config = (instance.config || {}) as Record<string, any>;
  const webhookSecret = config.webhook_secret;
  if (webhookSecret) {
    const authHeader = req.headers.get('authorization') || '';
    const secretHeader = req.headers.get('x-webhook-secret') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    
    if (bearerToken !== webhookSecret && secretHeader !== webhookSecret) {
      await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Invalid webhook secret', { sender_id: body.sender_id });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Validate required fields
  const { external_message_id, sender_id, message_text, timestamp, sender_name, media_url, media_type, thread_id } = body;
  if (!external_message_id || !sender_id) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Missing required fields: external_message_id, sender_id', body);
    return new Response(JSON.stringify({ error: 'Missing required fields: external_message_id, sender_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup instagram_account
  const { data: account } = await supabase
    .from('instagram_accounts')
    .select('id')
    .eq('integration_instance_id', instanceId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!account) {
    // Auto-create account for this instance
    const { data: newAccount, error: createErr } = await supabase
      .from('instagram_accounts')
      .insert({
        integration_instance_id: instanceId,
        instagram_page_id: body.instagram_page_id || null,
        is_active: true,
        status: 'active',
      })
      .select('id')
      .single();

    if (createErr) {
      await logEvent(supabase, instanceId, 'webhook_receive', 'error', `Failed to create account: ${createErr.message}`, body);
      return new Response(JSON.stringify({ error: 'Failed to create instagram account' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    var accountId = newAccount.id;
  } else {
    var accountId = account.id;
  }

  // Insert message (idempotent)
  const { error: msgErr } = await supabase
    .from('instagram_messages')
    .insert({
      instagram_account_id: accountId,
      external_message_id,
      sender_id,
      sender_name: sender_name || null,
      ig_thread_id: thread_id || null,
      direction: 'inbound',
      message_text: message_text || null,
      media_url: media_url || null,
      media_type: media_type || null,
      raw_payload: body,
      is_read: false,
      status: 'delivered',
      created_at: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    })
    .select('id')
    .single();

  if (msgErr) {
    // Check if duplicate (unique constraint violation)
    if (msgErr.code === '23505') {
      await logEvent(supabase, instanceId, 'webhook_receive', 'success', 'Duplicate message ignored', { external_message_id, sender_id });
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', `Insert failed: ${msgErr.message}`, { external_message_id, sender_id });
    return new Response(JSON.stringify({ error: 'Failed to save message' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Upsert instagram_contact
  await supabase
    .from('instagram_contacts')
    .upsert(
      {
        instagram_account_id: accountId,
        instagram_user_id: sender_id,
        instagram_username: body.sender_username || sender_name || null,
      },
      { onConflict: 'instagram_account_id,instagram_user_id' }
    );

  // Log success
  await logEvent(supabase, instanceId, 'webhook_receive', 'success', null, { external_message_id, sender_id, account_id: accountId });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

async function logEvent(
  supabase: any,
  instanceId: string,
  eventType: string,
  result: string,
  errorMessage: string | null,
  meta: Record<string, any>
) {
  try {
    await supabase.from('integration_logs').insert({
      instance_id: instanceId,
      event_type: eventType,
      payload_meta: { provider: 'apix_instagram_dm', channel: 'instagram', ...meta },
      result,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error('Failed to write integration log:', e);
  }
}
