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

  // ── Outbox actions: webhook secret auth (no JWT) ──
  if (action === 'outbox_pull' || action === 'outbox_ack') {
    return await handleOutbox(req, serviceClient, body, action);
  }

  // ── All other actions: JWT + RBAC ──
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = claimsData.claims.sub as string;

  const { data: isAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: userId, _role_code: 'admin' });
  const { data: isSuperAdmin } = await serviceClient.rpc('has_role_v2', { _user_id: userId, _role_code: 'super_admin' });
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
        return await sendReply(serviceClient, body, userId);
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

// ─── Outbox handlers ────────────────────────────────────────────────────────

async function handleOutbox(req: Request, supabase: any, body: any, action: string) {
  const { instagram_account_id } = body;
  if (!instagram_account_id) {
    return new Response(JSON.stringify({ error: 'Missing instagram_account_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup account
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

  // Get webhook_secret from integration instance config
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

  // Auth: Bearer token OR X-Webhook-Secret header (no Basic Auth)
  const authHeader = req.headers.get('authorization') || '';
  const secretHeader = req.headers.get('x-webhook-secret') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (bearerToken !== webhookSecret && secretHeader !== webhookSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'outbox_pull') {
    return await outboxPull(supabase, body, instagram_account_id);
  } else {
    return await outboxAck(supabase, body, instagram_account_id, account.integration_instance_id);
  }
}

async function outboxPull(supabase: any, body: any, accountId: string) {
  const limit = Math.min(Math.max(body.limit || 10, 1), 20);
  const lockId = crypto.randomUUID();

  // Atomic pull via RPC (FOR UPDATE SKIP LOCKED + requeue stale)
  const { data: messages, error } = await supabase.rpc('instagram_outbox_pull_v1', {
    p_account_id: accountId,
    p_limit: limit,
    p_lock_id: lockId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const result = (messages || []).map((m: any) => ({
    id: m.id,
    external_message_id: m.external_message_id,
    peer_id: m.peer_id,
    recipient_id: m.recipient_id,
    message_text: m.message_text,
    ig_thread_id: m.ig_thread_id,
    created_at: m.created_at,
    sending_lock_id: lockId,
  }));

  return new Response(JSON.stringify({ messages: result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function outboxAck(supabase: any, body: any, accountId: string, integrationInstanceId: string) {
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
      .eq('sending_lock_id', sending_lock_id)
      .eq('instagram_account_id', accountId)
      .eq('status', 'sending'); // guard: only finalize locked messages

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

// ─── Admin actions ──────────────────────────────────────────────────────────

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

  // A7: Resolve provider_kind for routing
  const { data: accountRow, error: accountErr } = await supabase
    .from('instagram_accounts')
    .select('id, provider_kind, integration_instance_id')
    .eq('id', instagram_account_id)
    .maybeSingle();

  if (accountErr || !accountRow) {
    throw new Error('instagram_account not found');
  }

  const providerKind = (accountRow.provider_kind || 'apixdrive').toLowerCase();
  const externalMsgId = client_msg_id || crypto.randomUUID();

  // Check idempotency
  const { data: existing } = await supabase
    .from('instagram_messages')
    .select('id, status')
    .eq('instagram_account_id', instagram_account_id)
    .eq('external_message_id', externalMsgId)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ ok: true, duplicate: true, message_id: existing.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Initial status: ManyChat = sending (sync send below), others (apixdrive) = queued (worker pulls)
  const initialStatus = providerKind === 'manychat' ? 'sending' : 'queued';

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
      status: initialStatus,
      peer_id: sender_id,
      recipient_id: sender_id,
      sent_by_admin: adminUserId,
      provider_kind: providerKind,
    })
    .select('id')
    .single();

  if (insertErr) throw insertErr;

  // ─── A7: ManyChat synchronous send branch ──────────────────────────────────
  if (providerKind === 'manychat') {
    const sendResult = await sendViaManyChat(
      supabase,
      accountRow.integration_instance_id,
      sender_id,
      message_text,
    );

    const finalStatus = sendResult.ok ? 'delivered' : 'failed';
    await supabase
      .from('instagram_messages')
      .update({
        status: finalStatus,
        error_message: sendResult.ok ? null : (sendResult.error || 'manychat send failed'),
        provider_message_id: sendResult.provider_message_id || null,
      })
      .eq('id', msg.id);

    // Integration log (non-blocking)
    try {
      await supabase.from('integration_logs').insert({
        instance_id: accountRow.integration_instance_id,
        event_type: 'manychat.send_content',
        payload_meta: {
          provider: 'manychat',
          channel: 'instagram',
          subscriber_id: sender_id,
          message_id: msg.id,
          status: finalStatus,
        },
        result: sendResult.ok ? 'success' : 'error',
        error_message: sendResult.ok ? null : sendResult.error,
      });
    } catch (e) {
      console.error('Failed to log manychat send:', e);
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'instagram_reply_sent',
      actor_type: 'user',
      actor_user_id: adminUserId,
      meta: {
        instagram_account_id,
        sender_id,
        message_id: msg.id,
        status: finalStatus,
        provider_kind: 'manychat',
        message_short: message_text.slice(0, 120),
      },
    });

    if (!sendResult.ok) {
      return new Response(
        JSON.stringify({ ok: false, message_id: msg.id, status: 'failed', error: sendResult.error }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message_id: msg.id, status: 'delivered', provider_kind: 'manychat' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ─── Legacy ApiX-Drive path (unchanged) ────────────────────────────────────
  await supabase.from('audit_logs').insert({
    action: 'instagram_reply_sent',
    actor_type: 'user',
    actor_user_id: adminUserId,
    meta: {
      instagram_account_id,
      sender_id,
      message_id: msg.id,
      status: 'queued',
      provider_kind: providerKind,
      message_short: message_text.slice(0, 120),
    },
  });

  return new Response(JSON.stringify({ ok: true, message_id: msg.id, status: 'queued' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── A7: ManyChat send helper ──────────────────────────────────────────────
async function sendViaManyChat(
  supabase: any,
  integrationInstanceId: string,
  subscriberId: string,
  text: string,
): Promise<{ ok: boolean; provider_message_id?: string; error?: string }> {
  // Read api_key from config_secrets (NOT config) — A5 contract
  const { data: instance, error: instErr } = await supabase
    .from('integration_instances')
    .select('config_secrets')
    .eq('id', integrationInstanceId)
    .maybeSingle();

  if (instErr || !instance) {
    return { ok: false, error: 'integration_instance not found' };
  }
  const apiKey = (instance.config_secrets || {})?.api_key;
  if (!apiKey || typeof apiKey !== 'string') {
    return { ok: false, error: 'manychat api_key missing in config_secrets' };
  }

  // ManyChat: subscriber_id must be a number when numeric.
  // Strategy: пробуем без message_tag (24h окно). Если ManyChat отвечает
  // "without a message tag" / "more than 24 hours" — повторяем с HUMAN_AGENT
  // (окно 7 дней для manual reply). Если и это не проходит — нормализованная UX-ошибка.
  const subIdNum = /^\d+$/.test(String(subscriberId)) ? Number(subscriberId) : subscriberId;

  const buildPayload = (tag?: string): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      subscriber_id: subIdNum,
      data: { version: 'v2', content: { messages: [{ type: 'text', text }] } },
    };
    if (tag) p.message_tag = tag;
    return p;
  };

  const callManychat = async (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      let parsed: any = null;
      try { parsed = await resp.json(); } catch {
        return { httpOk: false, status: resp.status, parsed: null, raw: `non-JSON (HTTP ${resp.status})` };
      }
      return { httpOk: resp.ok, status: resp.status, parsed, raw: null as string | null };
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') return { httpOk: false, status: 0, parsed: null, raw: 'timeout' };
      return { httpOk: false, status: 0, parsed: null, raw: e?.message || String(e) };
    }
  };

  const isOutside24h = (m: string) =>
    /without a message tag/i.test(m) || /more than 24 hours/i.test(m) || /last interaction was over/i.test(m);
  const isOutside7d = (m: string) =>
    /outside.*(allowed|messaging) window/i.test(m) || /more than 7 days/i.test(m);
  const isValidationError = (status: number, m: string) =>
    status === 422 || /validation error/i.test(m);

  const tryOnce = async (tag?: string) => {
    const r = await callManychat(buildPayload(tag));
    const msg = r.parsed?.message || r.parsed?.error?.message || r.parsed?.error || r.raw || `HTTP ${r.status}`;
    const fullDump = r.parsed ? JSON.stringify(r.parsed).slice(0, 500) : (r.raw || '');
    console.log('[manychat:sendContent]', { tag: tag || 'none', status: r.status, httpOk: r.httpOk, msg, body: fullDump });
    return { r, msg, fullDump };
  };

  // Attempt 1: без тега (24h standard reply window)
  const a1 = await tryOnce();
  if (a1.r.raw === 'timeout') return { ok: false, error: 'manychat send timeout (10s)' };
  if (a1.r.httpOk && (!a1.r.parsed?.status || a1.r.parsed.status === 'success')) {
    const pid = a1.r.parsed?.data?.message_id || a1.r.parsed?.data?.id || a1.r.parsed?.message_id || null;
    return { ok: true, provider_message_id: pid };
  }

  const needsTagRetry =
    isOutside24h(String(a1.msg)) ||
    isValidationError(a1.r.status, String(a1.msg));

  if (needsTagRetry) {
    // Attempt 2: HUMAN_AGENT (7-day window for manual replies — IG/FB)
    const a2 = await tryOnce('HUMAN_AGENT');
    if (a2.r.raw === 'timeout') return { ok: false, error: 'manychat send timeout (10s)' };
    if (a2.r.httpOk && (!a2.r.parsed?.status || a2.r.parsed.status === 'success')) {
      const pid = a2.r.parsed?.data?.message_id || a2.r.parsed?.data?.id || a2.r.parsed?.message_id || null;
      return { ok: true, provider_message_id: pid };
    }
    if (isOutside7d(String(a2.msg)) || isOutside24h(String(a2.msg))) {
      return { ok: false, error: 'Окно ответа истекло: подписчик не писал больше 7 дней. Meta запрещает отправку до нового входящего сообщения.' };
    }
    return { ok: false, error: `manychat http error: ${a2.msg} | dump: ${a2.fullDump}` };
  }

  return { ok: false, error: `manychat http error: ${a1.msg} | dump: ${a1.fullDump}` };
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
    query = query.eq('peer_id', sender_id);
  }

  const { error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
