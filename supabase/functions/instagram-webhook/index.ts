import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PAYLOAD_SIZE = 1024 * 256; // 256KB

// Tolerant field mapping
const FIELD_ALIASES: Record<string, string[]> = {
  external_message_id: ['external_message_id', 'message_id', 'id_message', 'mid'],
  sender_id: ['sender_id', 'psid', 'page_scoped_user_id', 'from_id', 'user_id'],
  message_text: ['message_text', 'text', 'message', 'body'],
  timestamp: ['timestamp', 'created_time', 'created_at', 'time'],
  sender_name: ['sender_name', 'from_name', 'name'],
  sender_username: ['sender_username', 'username', 'from_username'],
  media_url: ['media_url', 'attachment_url', 'image_url'],
  media_type: ['media_type', 'attachment_type'],
  thread_id: ['thread_id', 'conversation_id', 'chat_id'],
  sender_profile_picture: ['sender_profile_picture', 'profile_picture_url', 'avatar_url', 'profile_pic'],
};

function resolveField(body: Record<string, any>, canonical: string): any {
  const aliases = FIELD_ALIASES[canonical];
  if (!aliases) return body[canonical];
  for (const alias of aliases) {
    if (body[alias] !== undefined && body[alias] !== null && body[alias] !== '') {
      return body[alias];
    }
  }
  return undefined;
}

/**
 * Get UTC offset in ms for a timezone at a given UTC timestamp.
 * Positive = east of UTC.
 */
function getUtcOffsetMs(tz: string, utcMs: number): number {
  try {
    const d = new Date(utcMs);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(d);

    const get = (type: string): number => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };

    let localHour = get('hour');
    if (localHour === 24) localHour = 0;
    const localAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), localHour, get('minute'), get('second'));
    return localAsUtcMs - utcMs;
  } catch {
    // Fallback: assume UTC+1 (Warsaw winter)
    return 3600000;
  }
}

/**
 * Parse ApiX-Drive timestamp: DD.MM.YYYY HH:mm (Europe/Warsaw local time).
 * Returns ISO string in UTC.
 */
function parseApixTimestamp(raw: string | undefined | null): { iso: string; ok: boolean; raw_value: string } {
  const rawStr = raw ? String(raw).trim() : '';
  if (!rawStr) {
    return { iso: new Date().toISOString(), ok: false, raw_value: rawStr };
  }

  // FIX-1: DD.MM.YYYY HH:mm MUST be checked FIRST — Date.parse treats "04.03" as MM.DD (US format)
  const match = rawStr.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (match) {
    const [, day, month, year, hour, minute] = match;
    const y = parseInt(year), mo = parseInt(month) - 1, d = parseInt(day);
    const h = parseInt(hour), mi = parseInt(minute);

    // Build a UTC guess, then subtract Warsaw offset to get real UTC
    const guessUtcMs = Date.UTC(y, mo, d, h, mi, 0, 0);
    try {
      const warsawOffset = getUtcOffsetMs('Europe/Warsaw', guessUtcMs);
      const utcMs = guessUtcMs - warsawOffset;
      const result = new Date(utcMs);
      if (!isNaN(result.getTime())) {
        return { iso: result.toISOString(), ok: true, raw_value: rawStr };
      }
    } catch {
      // Fallback: treat as local (server is UTC in Edge)
      const fallback = new Date(Date.UTC(y, mo, d, h, mi));
      if (!isNaN(fallback.getTime())) {
        return { iso: fallback.toISOString(), ok: true, raw_value: rawStr };
      }
    }
  }

  // Then try standard Date.parse (ISO, RFC, etc.) — safe for non-DD.MM formats
  const stdParsed = Date.parse(rawStr);
  if (!isNaN(stdParsed)) {
    return { iso: new Date(stdParsed).toISOString(), ok: true, raw_value: rawStr };
  }

  // Fallback
  return { iso: new Date().toISOString(), ok: false, raw_value: rawStr };
}

/**
 * Build stable hash for external_message_id fallback.
 * Uses only deterministic fields so retries produce the same ID.
 */
async function buildStableHash(parts: Record<string, string | undefined | null>): Promise<string> {
  const input = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v ?? ''}`)
    .join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractDiagnostics(req: Request, body: any) {
  const authHeader = req.headers.get('authorization') || '';
  const secretHeader = req.headers.get('x-webhook-secret') || '';
  const hasAuth = !!authHeader || !!secretHeader;
  const authScheme = authHeader.startsWith('Bearer ') ? 'bearer' : secretHeader ? 'x-webhook-secret' : 'none';
  const contentType = req.headers.get('content-type') || 'unknown';
  const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : [];
  const instanceIdPresent = body && !!body.integration_instance_id;

  return {
    has_auth_header: hasAuth,
    auth_scheme: authScheme,
    content_type: contentType,
    body_keys: bodyKeys,
    integration_instance_id_present: instanceIdPresent,
    source: body?._source || 'apix',
  };
}

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

  // Payload size guard
  const contentLength = parseInt(req.headers.get('content-length') || '0');
  if (contentLength > MAX_PAYLOAD_SIZE) {
    console.error('[instagram-webhook] REJECTED: payload_too_large', JSON.stringify({
      content_type: req.headers.get('content-type'),
      has_auth: !!(req.headers.get('authorization') || req.headers.get('x-webhook-secret')),
      content_length: contentLength,
    }));
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Tolerant parsing: JSON first, then form-urlencoded fallback
  let body: any;
  const rawText = await req.text();

  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object') {
      body = parsed;
    } else {
      throw new Error('JSON parsed but not an object');
    }
  } catch {
    const params = new URLSearchParams(rawText);
    const keys = [...params.keys()];
    if (keys.length === 0) {
      console.error('[instagram-webhook] REJECTED: unparseable_body', JSON.stringify({
        has_auth: !!(req.headers.get('authorization') || req.headers.get('x-webhook-secret')),
        content_type: req.headers.get('content-type') || 'unknown',
      }));
      return new Response(JSON.stringify({ error: 'Unparseable body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    body = Object.fromEntries(params.entries());
  }

  const diag = extractDiagnostics(req, body);

  // Determine integration_instance_id from body or query param
  const url = new URL(req.url);
  const instanceId = body.integration_instance_id || url.searchParams.get('integration_instance_id');
  if (!instanceId) {
    console.error('[instagram-webhook] REJECTED: missing_instance_id', JSON.stringify(diag));
    return new Response(JSON.stringify({ error: 'Missing integration_instance_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup integration instance
  const { data: instance, error: instanceErr } = await supabase
    .from('integration_instances')
    .select('id, config, status')
    .eq('id', instanceId)
    .eq('provider', 'apix_instagram_dm')
    .single();

  if (instanceErr || !instance) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Integration instance not found', {
      ...diag, status_code: 404, reason: 'instance_not_found',
    });
    return new Response(JSON.stringify({ error: 'Integration not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Webhook secret is MANDATORY
  const config = (instance.config || {}) as Record<string, any>;
  const webhookSecret = config.webhook_secret;
  if (!webhookSecret) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'webhook_secret not configured', {
      ...diag, status_code: 409, reason: 'webhook_secret_missing',
    });
    return new Response(JSON.stringify({ error: 'Integration not configured: webhook_secret required' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate webhook secret
  const authHeader = req.headers.get('authorization') || '';
  const secretHeader = req.headers.get('x-webhook-secret') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (bearerToken !== webhookSecret && secretHeader !== webhookSecret) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Invalid webhook secret', {
      ...diag, status_code: 401, reason: 'invalid_secret',
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Tolerant field mapping
  const externalMessageId = resolveField(body, 'external_message_id');
  const senderId = resolveField(body, 'sender_id');
  const messageText = resolveField(body, 'message_text');
  const timestamp = resolveField(body, 'timestamp');
  const senderName = resolveField(body, 'sender_name');
  const senderUsername = resolveField(body, 'sender_username');
  const rawMediaUrl = resolveField(body, 'media_url');
  const rawMediaType = resolveField(body, 'media_type');
  const threadId = resolveField(body, 'thread_id');
  const senderProfilePicture = resolveField(body, 'sender_profile_picture');

  // PATCH-2: Media guard — separate avatar from real attachment
  let messageMediaUrl: string | null = null;
  let messageMediaType: string | null = null;

  if (rawMediaUrl) {
    const isAvatar = rawMediaType === 'avatar' || (senderProfilePicture && rawMediaUrl === senderProfilePicture);
    if (!isAvatar) {
      messageMediaUrl = rawMediaUrl;
      messageMediaType = rawMediaType || null;
    }
  }

  // PATCH-1: Generate stable external_message_id if missing
  // Uses deterministic hash from stable event fields — retries produce the same ID
  let finalExternalMessageId = externalMessageId;
  if (!finalExternalMessageId && senderId) {
    const hashHex = await buildStableHash({
      sender_id: senderId,
      timestamp_raw: timestamp ? String(timestamp) : undefined,
      message_text: messageText ? String(messageText) : undefined,
      media_url: rawMediaUrl ? String(rawMediaUrl) : undefined,
      thread_id: threadId ? String(threadId) : undefined,
      instagram_page_id: body.instagram_page_id ? String(body.instagram_page_id) : undefined,
    });
    finalExternalMessageId = `apix:${senderId}:${timestamp || 'notime'}:${hashHex}`;
  }

  if (!finalExternalMessageId || !senderId) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Missing required fields: external_message_id, sender_id', {
      ...diag, status_code: 400, reason: 'missing_required_fields',
      resolved_external_message_id: finalExternalMessageId || null,
      resolved_sender_id: senderId || null,
    });
    return new Response(JSON.stringify({ error: 'Missing required fields: external_message_id, sender_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup existing instagram_account — NO auto-create
  const { data: account } = await supabase
    .from('instagram_accounts')
    .select('id, instagram_page_id')
    .eq('integration_instance_id', instanceId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!account) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Instagram account not found for instance. Create account via UI first.', {
      ...diag, status_code: 404, reason: 'account_not_found', sender_id: senderId,
    });
    return new Response(JSON.stringify({ error: 'Instagram account not found for this instance' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Optional guard: if payload has instagram_page_id, verify match
  if (body.instagram_page_id && account.instagram_page_id && body.instagram_page_id !== account.instagram_page_id) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', `page_id mismatch: expected ${account.instagram_page_id}, got ${body.instagram_page_id}`, {
      ...diag, status_code: 400, reason: 'page_id_mismatch', sender_id: senderId,
    });
    return new Response(JSON.stringify({ error: 'instagram_page_id mismatch' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const accountId = account.id;

  // PATCH-2: Safe timestamp parsing (DD.MM.YYYY HH:mm from ApiX, Europe/Warsaw)
  const parsedTs = parseApixTimestamp(timestamp);
  if (!parsedTs.ok) {
    console.warn('[instagram-webhook] timestamp_parse_warning', JSON.stringify({
      timestamp_raw: parsedTs.raw_value.slice(0, 30),
      fallback: parsedTs.iso,
      sender_id: senderId,
    }));
  }

  // PATCH-MEDIA: Legacy URL fallback — если media_url пуст, но в message_text лежит URL медиафайла,
  // поднимаем его в media_url + угадываем media_type.
  if (!messageMediaUrl && messageText) {
    const txt = String(messageText).trim();
    const urlOnly = /^https?:\/\/\S+$/i.test(txt) ? txt : null;
    if (urlOnly) {
      const lower = urlOnly.toLowerCase();
      let guessedType: string | null = null;
      if (/\.(jpe?g|png|gif|webp|bmp|heic)(?:[?#]|$)/i.test(lower) || /lookaside\.fbsbx\.com.*ig_messaging_cdn/i.test(urlOnly)) guessedType = 'image';
      else if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(lower)) guessedType = 'video';
      else if (/\.(mp3|m4a|ogg|opus|wav|aac)(?:[?#]|$)/i.test(lower)) guessedType = 'audio';
      else if (/\.(pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i.test(lower)) guessedType = 'file';
      if (guessedType) {
        messageMediaUrl = urlOnly;
        messageMediaType = guessedType;
      }
    }
  }

  // PATCH: priority detection for media_type — НЕ доверять blindly значению от ManyChat.
  // Если URL имеет явное video/audio расширение, тип media_type override-им,
  // даже если ManyChat прислал media_type='image'.
  if (messageMediaUrl) {
    const lower = messageMediaUrl.toLowerCase();
    if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(lower)) {
      messageMediaType = 'video';
    } else if (/\.(mp3|m4a|ogg|opus|wav|aac)(?:[?#]|$)/i.test(lower)) {
      messageMediaType = 'audio';
    } else if (/\.(pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i.test(lower)) {
      messageMediaType = 'file';
    }
    // image и неизвестные типы — оставляем как есть (rehost потом уточнит по Content-Type)
  }

  // Insert message with peer_id
  const { data: insertedMsg, error: msgErr } = await supabase
    .from('instagram_messages')
    .insert({
      instagram_account_id: accountId,
      external_message_id: finalExternalMessageId,
      sender_id: senderId,
      sender_name: senderName || null,
      ig_thread_id: threadId || null,
      direction: 'inbound',
      message_text: messageText || null,
      media_url: messageMediaUrl,
      media_type: messageMediaType,
      raw_payload: body,
      is_read: false,
      status: 'delivered',
      peer_id: senderId,
      sent_by_admin: null,
      recipient_id: null,
      created_at: parsedTs.iso,
    })
    .select('id')
    .single();

  // PATCH-MEDIA: Fire-and-forget rehost для нестабильных Instagram CDN URLs.
  // Не ждём ответа — UI ленивого rehost-а тоже подхватит, если этот вызов не успеет.
  if (!msgErr && insertedMsg?.id && messageMediaUrl &&
      /(lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com)/i.test(messageMediaUrl)) {
    const proxyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-media-proxy`;
    fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      },
      body: JSON.stringify({
        message_id: insertedMsg.id,
        source_url: messageMediaUrl,
        media_type: messageMediaType,
      }),
    }).catch((e) => console.warn('[instagram-webhook] rehost dispatch failed:', e?.message));
  }

  if (msgErr) {
    if (msgErr.code === '23505') {
      await logEvent(supabase, instanceId, 'webhook_receive', 'success', 'Duplicate message ignored', {
        ...diag, status_code: 200, reason: 'duplicate',
        external_message_id: finalExternalMessageId, sender_id: senderId,
      });
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', `Insert failed: ${msgErr.message}`, {
      ...diag, status_code: 500, reason: 'db_insert_failed',
      external_message_id: finalExternalMessageId, sender_id: senderId,
    });
    return new Response(JSON.stringify({ error: 'Failed to save message' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // PATCH-3: Upsert instagram_contact — protect instagram_username from overwrite
  const trimmedUsername = senderUsername && typeof senderUsername === 'string' ? senderUsername.trim() : '';

  const upsertData: Record<string, any> = {
    instagram_account_id: accountId,
    instagram_user_id: senderId,
    full_name: senderName || null,
    avatar_url: senderProfilePicture || null,
  };

  if (trimmedUsername) {
    // We have a real username — set it directly
    upsertData.instagram_username = trimmedUsername;
  } else {
    // No username in payload — need to preserve existing value
    // SELECT only when needed to avoid overwriting with null
    const { data: existingContact } = await supabase
      .from('instagram_contacts')
      .select('instagram_username')
      .eq('instagram_account_id', accountId)
      .eq('instagram_user_id', senderId)
      .maybeSingle();

    upsertData.instagram_username = existingContact?.instagram_username || null;
  }

  await supabase
    .from('instagram_contacts')
    .upsert(upsertData, { onConflict: 'instagram_account_id,instagram_user_id' });

  // Log success with timestamp diagnostics
  await logEvent(supabase, instanceId, 'webhook_receive', 'success', null, {
    ...diag, status_code: 200, reason: 'ok',
    external_message_id: finalExternalMessageId, sender_id: senderId,
    account_id: accountId,
    timestamp_raw: parsedTs.raw_value.slice(0, 30),
    timestamp_parsed_ok: parsedTs.ok,
    has_avatar: !!senderProfilePicture,
    has_media: !!messageMediaUrl,
  });

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
