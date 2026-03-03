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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Auth check
  const authHeader = req.headers.get('authorization') || '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // RBAC check
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: isAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: user.id, _role_code: 'admin' });
  const { data: isSuperAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: user.id, _role_code: 'super_admin' });
  if (!isAdmin && !isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { action } = body;

  try {
    switch (action) {
      case 'get_history':
        return await getHistory(serviceClient, body);
      case 'send_reply':
        return await sendReply(serviceClient, body, user.id);
      case 'mark_read':
        return await markRead(serviceClient, body);
      case 'get_accounts':
        return await getAccounts(serviceClient);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (e: any) {
    console.error('instagram-admin-chat error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getAccounts(supabase: any) {
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('id, integration_instance_id, instagram_page_id, is_active, status, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return new Response(JSON.stringify({ accounts: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getHistory(supabase: any, body: any) {
  const { instagram_account_id, sender_id, thread_id, limit: lim = 50, offset = 0 } = body;
  if (!instagram_account_id) throw new Error('Missing instagram_account_id');
  if (!sender_id && !thread_id) throw new Error('Missing sender_id or thread_id');

  let query = supabase
    .from('instagram_messages')
    .select('*')
    .eq('instagram_account_id', instagram_account_id)
    .order('created_at', { ascending: true })
    .range(offset, offset + lim - 1);

  if (thread_id) {
    query = query.eq('ig_thread_id', thread_id);
  } else {
    query = query.eq('sender_id', sender_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ messages: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendReply(supabase: any, body: any, adminUserId: string) {
  const { instagram_account_id, sender_id, thread_id, message_text, client_msg_id } = body;
  if (!instagram_account_id || !sender_id || !message_text) {
    throw new Error('Missing required fields: instagram_account_id, sender_id, message_text');
  }

  const externalMsgId = client_msg_id || crypto.randomUUID();

  // Check idempotency — don't create duplicate outbound
  const { data: existing } = await supabase
    .from('instagram_messages')
    .select('id')
    .eq('instagram_account_id', instagram_account_id)
    .eq('external_message_id', externalMsgId)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ ok: true, duplicate: true, message_id: existing.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get ApiX API key from integration instance
  const { data: account } = await supabase
    .from('instagram_accounts')
    .select('id, integration_instance_id')
    .eq('id', instagram_account_id)
    .single();

  if (!account) throw new Error('Instagram account not found');

  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('id', account.integration_instance_id)
    .single();

  const config = (instance?.config || {}) as Record<string, any>;
  const apixApiKey = config.apix_api_key;

  let sendStatus = 'delivered';
  let sendError: string | null = null;

  // Try to send via ApiX-Drive API (if key configured)
  if (apixApiKey) {
    try {
      // ApiX-Drive send message endpoint
      // This is a placeholder — actual endpoint depends on ApiX-Drive API docs
      const response = await fetch('https://api.apix-drive.com/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apixApiKey}`,
        },
        body: JSON.stringify({
          recipient_id: sender_id,
          message: message_text,
          thread_id: thread_id || undefined,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        sendStatus = 'failed';
        sendError = `ApiX API error: ${response.status} ${errText.slice(0, 200)}`;
      }
    } catch (e: any) {
      sendStatus = 'failed';
      sendError = `ApiX API call failed: ${e.message}`;
    }
  } else {
    // No API key — save as pending (manual send)
    sendStatus = 'pending';
    sendError = 'ApiX API key not configured — message saved but not sent';
  }

  // Insert outbound message
  const { data: msg, error: insertErr } = await supabase
    .from('instagram_messages')
    .insert({
      instagram_account_id,
      external_message_id: externalMsgId,
      sender_id: 'admin',
      sender_name: 'Admin',
      ig_thread_id: thread_id || null,
      direction: 'outbound',
      message_text,
      status: sendStatus,
      error_message: sendError,
    })
    .select('id')
    .single();

  if (insertErr) throw insertErr;

  // Audit log
  await supabase.from('audit_logs').insert({
    action: 'instagram_reply_sent',
    actor_type: 'user',
    actor_user_id: adminUserId,
    meta: {
      instagram_account_id,
      sender_id,
      message_id: msg.id,
      status: sendStatus,
      message_short: message_text.slice(0, 120),
    },
  });

  if (sendStatus === 'failed') {
    return new Response(JSON.stringify({ ok: false, error: sendError, message_id: msg.id }), {
      status: 200, // 200 because message was saved
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, message_id: msg.id, status: sendStatus }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function markRead(supabase: any, body: any) {
  const { instagram_account_id, sender_id, thread_id } = body;
  if (!instagram_account_id) throw new Error('Missing instagram_account_id');
  if (!sender_id && !thread_id) throw new Error('Missing sender_id or thread_id');

  let query = supabase
    .from('instagram_messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('instagram_account_id', instagram_account_id)
    .eq('is_read', false)
    .eq('direction', 'inbound');

  if (thread_id) {
    query = query.eq('ig_thread_id', thread_id);
  } else {
    query = query.eq('sender_id', sender_id);
  }

  const { error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
