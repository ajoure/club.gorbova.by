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
  const {
    instagram_account_id,
    sender_id,
    thread_id,
    message_text,
    client_msg_id,
    media_url,
    media_type, // 'image' | 'audio' | 'video' | 'file'
  } = body;
  if (!instagram_account_id || !sender_id) {
    throw new Error('Missing required fields: instagram_account_id, sender_id');
  }
  // Либо текст, либо media — что-то одно обязательно.
  if (!message_text && !media_url) {
    throw new Error('Missing message_text or media_url');
  }
  if (media_url && !media_type) {
    throw new Error('media_type required when media_url provided');
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
      msg.id,
    );

    const finalStatus = sendResult.ok ? 'delivered' : 'failed';
    await supabase
      .from('instagram_messages')
      .update({
        status: finalStatus,
        error_message: sendResult.ok ? null : (sendResult.user_error || sendResult.error || 'manychat send failed'),
        provider_message_id: sendResult.provider_message_id || null,
      })
      .eq('id', msg.id);

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

    // payment-error-handling standard: всегда HTTP 200, нормализованный JSON.
    // UI не должен ловить runtime overlay/502 на бизнес-ошибки провайдера.
    if (!sendResult.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          fallback: true,
          message_id: msg.id,
          status: 'failed',
          error_code: sendResult.error_code || 'manychat_send_failed',
          error: sendResult.user_error || sendResult.error || 'Не удалось отправить сообщение',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
  messageId: string,
): Promise<{
  ok: boolean;
  provider_message_id?: string;
  error?: string;        // raw error для logs
  user_error?: string;   // нормализованный для UI
  error_code?: string;
}> {
  // Read api_key from config_secrets (NOT config) — A5 contract
  const { data: instance, error: instErr } = await supabase
    .from('integration_instances')
    .select('config_secrets')
    .eq('id', integrationInstanceId)
    .maybeSingle();

  if (instErr || !instance) {
    return { ok: false, error: 'integration_instance not found', user_error: 'Конфигурация ManyChat не найдена', error_code: 'instance_missing' };
  }
  const apiKey = (instance.config_secrets || {})?.api_key;
  if (!apiKey || typeof apiKey !== 'string') {
    return { ok: false, error: 'manychat api_key missing', user_error: 'API-ключ ManyChat не настроен', error_code: 'api_key_missing' };
  }

  const subIdNum = /^\d+$/.test(String(subscriberId)) ? Number(subscriberId) : subscriberId;

  // Canonical ManyChat /fb/sending/sendContent payload v2.
  // message_tag — на верхнем уровне (не внутри data).
  // content.type = 'instagram' для IG DM.
  const buildPayload = (tag?: string): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      subscriber_id: subIdNum,
      data: {
        version: 'v2',
        content: {
          type: 'instagram',
          messages: [{ type: 'text', text }],
        },
      },
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
      const rawText = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(rawText); } catch {}
      return { httpOk: resp.ok, status: resp.status, parsed, rawBody: rawText.slice(0, 1000) };
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') return { httpOk: false, status: 0, parsed: null, rawBody: 'timeout' };
      return { httpOk: false, status: 0, parsed: null, rawBody: e?.message || String(e) };
    }
  };

  const isOutside24h = (m: string) =>
    /without a message tag/i.test(m) || /more than 24 hours/i.test(m) || /last interaction was over/i.test(m);
  const isOutside7d = (m: string) =>
    /outside.*(allowed|messaging) window/i.test(m) || /more than 7 days/i.test(m);
  const isValidationError = (status: number, m: string) =>
    status === 422 || /validation error/i.test(m);

  const logAttempt = async (
    attemptNo: number,
    tag: string | null,
    r: { httpOk: boolean; status: number; parsed: any; rawBody: string },
    outcome: 'success' | 'error',
  ) => {
    try {
      const topKeys = r.parsed && typeof r.parsed === 'object' ? Object.keys(r.parsed) : [];
      await supabase.from('integration_logs').insert({
        instance_id: integrationInstanceId,
        event_type: 'manychat.send.response',
        result: outcome,
        error_message: outcome === 'error' ? (r.parsed?.message || r.parsed?.error?.message || r.rawBody?.slice(0, 200) || `HTTP ${r.status}`) : null,
        payload_meta: {
          provider: 'manychat',
          channel: 'instagram',
          message_id: messageId,
          subscriber_id: String(subscriberId),
          attempt_no: attemptNo,
          message_tag: tag,
          http_status: r.status,
          http_ok: r.httpOk,
          response_top_keys: topKeys,
          response_body_preview: r.rawBody?.slice(0, 1000) ?? null,
        },
      });
    } catch (e) {
      console.error('[manychat] log_attempt_failed', e);
    }
  };

  const tryOnce = async (attemptNo: number, tag?: string) => {
    const r = await callManychat(buildPayload(tag));
    const msg = r.parsed?.message || r.parsed?.error?.message || r.parsed?.error || r.rawBody || `HTTP ${r.status}`;
    const isSuccess = r.httpOk && (!r.parsed?.status || r.parsed.status === 'success');
    await logAttempt(attemptNo, tag || null, r, isSuccess ? 'success' : 'error');
    console.log('[manychat:sendContent]', { attempt: attemptNo, tag: tag || 'none', status: r.status, httpOk: r.httpOk, msg: String(msg).slice(0, 200) });
    return { r, msg: String(msg), isSuccess };
  };

  // Retry chain (строго):
  //   #1 без tag (24h standard reply window)
  //   #2 HUMAN_AGENT — только если 24h окно закрыто ИЛИ Validation error
  //   #3 нормализованный fail (без runtime crash)

  const a1 = await tryOnce(1);
  if (a1.r.rawBody === 'timeout') {
    return { ok: false, error: 'manychat send timeout', user_error: 'Превышено время ожидания ManyChat (10с)', error_code: 'timeout' };
  }
  if (a1.isSuccess) {
    const pid = a1.r.parsed?.data?.message_id || a1.r.parsed?.data?.id || a1.r.parsed?.message_id || null;
    return { ok: true, provider_message_id: pid };
  }

  const needsTagRetry = isOutside24h(a1.msg) || isValidationError(a1.r.status, a1.msg);

  if (needsTagRetry) {
    const a2 = await tryOnce(2, 'HUMAN_AGENT');
    if (a2.r.rawBody === 'timeout') {
      return { ok: false, error: 'manychat send timeout', user_error: 'Превышено время ожидания ManyChat (10с)', error_code: 'timeout' };
    }
    if (a2.isSuccess) {
      const pid = a2.r.parsed?.data?.message_id || a2.r.parsed?.data?.id || a2.r.parsed?.message_id || null;
      return { ok: true, provider_message_id: pid };
    }
    if (isOutside7d(a2.msg) || isOutside24h(a2.msg)) {
      return {
        ok: false,
        error: a2.msg,
        user_error: 'Окно ответа истекло: подписчик не писал больше 7 дней. Meta запрещает отправку до нового входящего сообщения.',
        error_code: 'window_closed',
      };
    }
    return {
      ok: false,
      error: a2.msg,
      user_error: 'Не удалось отправить через ManyChat. Проверьте настройку аккаунта.',
      error_code: 'manychat_error',
    };
  }

  return {
    ok: false,
    error: a1.msg,
    user_error: 'Не удалось отправить через ManyChat. Проверьте настройку аккаунта.',
    error_code: 'manychat_error',
  };
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
