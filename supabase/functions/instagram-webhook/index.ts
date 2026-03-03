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

  // PATCH-1: Log even before JSON parse (console only for pre-instance errors due to FK constraint)
  let body: any;
  try {
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

    const rawText = await req.text();
    const ct = (req.headers.get('content-type') || '').toLowerCase();

    if (ct.includes('application/json')) {
      body = JSON.parse(rawText);
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawText);
      body = Object.fromEntries(params.entries());
    } else {
      // Fallback: try JSON first, then form-urlencoded
      try {
        body = JSON.parse(rawText);
      } catch {
        const params = new URLSearchParams(rawText);
        if ([...params.keys()].length > 0) {
          body = Object.fromEntries(params.entries());
        } else {
          throw new Error('Unparseable body');
        }
      }
    }
  } catch (parseErr) {
    console.error('[instagram-webhook] REJECTED: unparseable_body', JSON.stringify({
      has_auth: !!(req.headers.get('authorization') || req.headers.get('x-webhook-secret')),
      content_type: req.headers.get('content-type') || 'unknown',
      error: String(parseErr),
    }));
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
      ...diag,
      status_code: 404,
      reason: 'instance_not_found',
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
      ...diag,
      status_code: 409,
      reason: 'webhook_secret_missing',
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
      ...diag,
      status_code: 401,
      reason: 'invalid_secret',
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // PATCH-5: Tolerant field mapping
  const externalMessageId = resolveField(body, 'external_message_id');
  const senderId = resolveField(body, 'sender_id');
  const messageText = resolveField(body, 'message_text');
  const timestamp = resolveField(body, 'timestamp');
  const senderName = resolveField(body, 'sender_name');
  const senderUsername = resolveField(body, 'sender_username');
  const mediaUrl = resolveField(body, 'media_url');
  const mediaType = resolveField(body, 'media_type');
  const threadId = resolveField(body, 'thread_id');

  // Generate safe external_message_id if missing
  let finalExternalMessageId = externalMessageId;
  if (!finalExternalMessageId && senderId && timestamp) {
    finalExternalMessageId = `apix:${senderId}:${timestamp}`;
  } else if (!finalExternalMessageId && senderId) {
    finalExternalMessageId = `apix:${senderId}:${Date.now()}`;
  }

  if (!finalExternalMessageId || !senderId) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', 'Missing required fields: external_message_id, sender_id', {
      ...diag,
      status_code: 400,
      reason: 'missing_required_fields',
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
      ...diag,
      status_code: 404,
      reason: 'account_not_found',
      sender_id: senderId,
    });
    return new Response(JSON.stringify({ error: 'Instagram account not found for this instance' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Optional guard: if payload has instagram_page_id, verify match
  if (body.instagram_page_id && account.instagram_page_id && body.instagram_page_id !== account.instagram_page_id) {
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', `page_id mismatch: expected ${account.instagram_page_id}, got ${body.instagram_page_id}`, {
      ...diag,
      status_code: 400,
      reason: 'page_id_mismatch',
      sender_id: senderId,
    });
    return new Response(JSON.stringify({ error: 'instagram_page_id mismatch' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const accountId = account.id;

  // Insert message with peer_id
  const { error: msgErr } = await supabase
    .from('instagram_messages')
    .insert({
      instagram_account_id: accountId,
      external_message_id: finalExternalMessageId,
      sender_id: senderId,
      sender_name: senderName || null,
      ig_thread_id: threadId || null,
      direction: 'inbound',
      message_text: messageText || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      raw_payload: body,
      is_read: false,
      status: 'delivered',
      peer_id: senderId,
      sent_by_admin: null,
      recipient_id: null,
      created_at: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    })
    .select('id')
    .single();

  if (msgErr) {
    if (msgErr.code === '23505') {
      await logEvent(supabase, instanceId, 'webhook_receive', 'success', 'Duplicate message ignored', {
        ...diag,
        status_code: 200,
        reason: 'duplicate',
        external_message_id: finalExternalMessageId,
        sender_id: senderId,
        source: diag.source,
      });
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await logEvent(supabase, instanceId, 'webhook_receive', 'error', `Insert failed: ${msgErr.message}`, {
      ...diag,
      status_code: 500,
      reason: 'db_insert_failed',
      external_message_id: finalExternalMessageId,
      sender_id: senderId,
    });
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
        instagram_user_id: senderId,
        instagram_username: senderUsername || senderName || null,
      },
      { onConflict: 'instagram_account_id,instagram_user_id' }
    );

  // Log success
  await logEvent(supabase, instanceId, 'webhook_receive', 'success', null, {
    ...diag,
    status_code: 200,
    reason: 'ok',
    external_message_id: finalExternalMessageId,
    sender_id: senderId,
    account_id: accountId,
    source: diag.source,
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
