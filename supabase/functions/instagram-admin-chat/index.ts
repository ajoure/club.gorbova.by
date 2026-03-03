import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

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
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // PATCH-7: outbox_pull and outbox_ack use webhook secret auth (no JWT)
  if (action === 'outbox_pull' || action === 'outbox_ack') {
    return await handleOutbox(req, serviceClient, body, action);
  }

  // All other actions require JWT + RBAC
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

  const { data: isAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: user.id, _role_code: 'admin' });
  const { data: isSuperAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: user.id, _role_code: 'super_admin' });
  if (!isAdmin && !isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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

// ─── Outbox handlers (PATCH-7) ─────────────────────────────────────────────

async function handleOutbox(req: Request, supabase: any, body: any, action: string) {
  const { instagram_account_id } = body;
  if (!instagram_account_id) {
    return new Response(JSON.stringify({ error: 'Missing instagram_account_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Auth: validate webhook secret from integration instance
  const { data: account } = await supabase
    .from('instagram_accounts')
    .select('id, integration_instance_id')
    .eq('id', instagram_account_id)
    .eq('is_active', true)
    .single();

  if (!account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('id', account.integration_instance_id)
    .single();

  const config = (instance?.config || {}) as Record<string, any>;
  const webhookSecret = config.webhook_secret;
  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: 'webhook_secret not configured' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check auth: Bearer token, X-Webhook-Secret header, or Basic Auth
  const authHeader = req.headers.get('authorization') || '';
  const secretHeader = req.headers.get('x-webhook-secret') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let basicMatch = false;
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const [, password] = decoded.split(':');
      basicMatch = password === webhookSecret;
    } catch { /* ignore */ }
  }

  if (bearerToken !== webhookSecret && secretHeader !== webhookSecret && !basicMatch) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'outbox_pull') {
    return await outboxPull(supabase, body, instagram_account_id);
  } else {
    return await outboxAck(supabase, body, account.integration_instance_id);
  }
}

async function outboxPull(supabase: any, body: any, accountId: string) {
  const limit = Math.min(body.limit || 10, 20); // STOP-guard: max 20

  // Requeue stale sending (lock expired > 10 min)
  await supabase
    .from('instagram_messages')
    .update({ status: 'queued', sending_at: null, sending_lock_id: null })
    .eq('instagram_account_id', accountId)
    .eq('status', 'sending')
    .lt('sending_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Fetch queued messages
  const { data: messages, error } = await supabase
    .from('instagram_messages')
    .select('id, external_message_id, peer_id, recipient_id, message_text, ig_thread_id, created_at')
    .eq('instagram_account_id', accountId)
    .eq('status', 'queued')
    .eq('direction', 'outbound')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ messages: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lock messages atomically
  const lockId = crypto.randomUUID();
  const ids = messages.map((m: any) => m.id);

  await supabase
    .from('instagram_messages')
    .update({ status: 'sending', sending_at: new Date().toISOString(), sending_lock_id: lockId })
    .in('id', ids)
    .eq('status', 'queued');

  const result = messages.map((m: any) => ({
    ...m,
    sending_lock_id: lockId,
  }));

  return new Response(JSON.stringify({ messages: result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function outboxAck(supabase: any, body: any, integrationInstanceId: string) {
  const { messages: ackMessages } = body;
  if (!Array.isArray(ackMessages) || ackMessages.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing messages array' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // STOP-guard: max 50 acks per call
  if (ackMessages.length > 50) {
    return new Response(JSON.stringify({ error: 'Too many acks (max 50)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let okCount = 0;
  let errCount = 0;

  for (const ack of ackMessages) {
    const { external_message_id, sending_lock_id, result, error_message } = ack;
    if (!external_message_id || !sending_lock_id || !result) {
      errCount++;
      continue;
    }

    const newStatus = result === 'ok' ? 'delivered' : 'failed';
    const { error } = await supabase
      .from('instagram_messages')
      .update({
        status: newStatus,
        error_message: result === 'error' ? (error_message || 'Unknown error') : null,
        sending_at: null,
        sending_lock_id: null,
      })
      .eq('external_message_id', external_message_id)
      .eq('sending_lock_id', sending_lock_id);

    if (error) {
      errCount++;
    } else {
      okCount++;
    }
  }

  // Log aggregate
  try {
    await supabase.from('integration_logs').insert({
      instance_id: integrationInstanceId,
      event_type: 'outbox_ack',
      payload_meta: { provider: 'apix_instagram_dm', channel: 'instagram', ok: okCount, errors: errCount },
      result: errCount > 0 ? 'partial' : 'success',
      error_message: errCount > 0 ? `${errCount} ack(s) failed` : null,
    });
  } catch (e) {
    console.error('Failed to log outbox_ack:', e);
  }

  return new Response(JSON.stringify({ ok: true, processed: okCount, errors: errCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Admin actions ─────────────────────────────────────────────────────────

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

  // PATCH-5: Filter by peer_id instead of sender_id for dialog view
  if (thread_id) {
    query = query.eq('ig_thread_id', thread_id);
  } else {
    query = query.eq('peer_id', sender_id);
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

  // Check idempotency
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

  // PATCH-7: Always save as queued — no placeholder API call
  const { data: msg, error: insertErr } = await supabase
    .from('instagram_messages')
    .insert({
      instagram_account_id,
      external_message_id: externalMsgId,
      sender_id: 'system',
      sender_name: 'Admin',
      ig_thread_id: thread_id || null,
      direction: 'outbound',
      message_text,
      status: 'queued',
      // PATCH-5: proper peer/admin tracking
      peer_id: sender_id,
      recipient_id: sender_id,
      sent_by_admin: adminUserId,
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
      status: 'queued',
      message_short: message_text.slice(0, 120),
    },
  });

  return new Response(JSON.stringify({ ok: true, message_id: msg.id, status: 'queued' }), {
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

  // PATCH-5: use peer_id for marking read
  if (thread_id) {
    query = query.eq('ig_thread_id', thread_id);
  } else {
    query = query.eq('peer_id', sender_id);
  }

  const { error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
