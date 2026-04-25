// TEMP edge function for Sprint B forced smoke runs (#4 / #5).
// Will be deleted after smoke completes.
//
// Safety:
//   - requires user JWT with permission `entitlements.manage`
//   - reads BROADCAST_FORCE_SECRET from env (never returned, never logged)
//   - validates template name matches "[Sprint B smoke #4]" or "[Sprint B smoke #5]"
//   - validates send_mode='scheduled', channels match expected, audience resolves to >=1
//   - delegates real send to process-scheduled-broadcasts (system-actor path)

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface TriggerRequest {
  force_template_id?: string;
  dry_run?: boolean;
}

interface ExpectedTemplateConfig {
  smokeMarker: '#4' | '#5';
  expectedChannels: string[];
}

const SMOKE_TEMPLATE_RULES: Array<{
  matcher: RegExp;
  config: ExpectedTemplateConfig;
}> = [
  {
    matcher: /\[Sprint B smoke #4\]/,
    config: { smokeMarker: '#4', expectedChannels: ['email'] },
  },
  {
    matcher: /\[Sprint B smoke #5\]/,
    config: { smokeMarker: '#5', expectedChannels: ['telegram', 'email'] },
  },
];

function jsonRes(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const forceSecret = Deno.env.get('BROADCAST_FORCE_SECRET') || '';

  if (!forceSecret) {
    return jsonRes({ ok: false, error: 'force_secret_not_configured' }, { status: 500 });
  }

  // ===== Auth: user JWT + entitlements.manage =====
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return jsonRes({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: hasPerm, error: permErr } = await adminClient.rpc('has_permission', {
    _user_id: userId,
    _permission_code: 'entitlements.manage',
  });
  if (permErr || !hasPerm) {
    return jsonRes({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  // ===== Body =====
  let body: TriggerRequest = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const forceTemplateId = body.force_template_id;
  if (!forceTemplateId || typeof forceTemplateId !== 'string') {
    return jsonRes({ ok: false, error: 'force_template_id_required' }, { status: 400 });
  }

  // ===== Pre-check: template exists and matches smoke whitelist =====
  const { data: tpl, error: tplErr } = await adminClient
    .from('broadcast_templates')
    .select('id, name, channel, channels, status, send_mode, audience_filters')
    .eq('id', forceTemplateId)
    .maybeSingle();

  if (tplErr || !tpl) {
    return jsonRes({ ok: false, error: 'template_not_found' }, { status: 404 });
  }

  const matchedRule = SMOKE_TEMPLATE_RULES.find((r) => r.matcher.test(tpl.name || ''));
  if (!matchedRule) {
    return jsonRes(
      {
        ok: false,
        error: 'template_not_whitelisted',
        message:
          'Only templates named "[Sprint B smoke #4] ..." or "[Sprint B smoke #5] ..." may be forced via this helper.',
        template_name: tpl.name,
      },
      { status: 403 }
    );
  }

  const channels: string[] =
    Array.isArray(tpl.channels) && tpl.channels.length > 0
      ? tpl.channels
      : tpl.channel
        ? [tpl.channel]
        : [];

  const expected = matchedRule.config.expectedChannels;
  const sameChannels =
    channels.length === expected.length &&
    expected.every((c) => channels.includes(c));

  if (!sameChannels) {
    return jsonRes(
      {
        ok: false,
        error: 'channels_mismatch',
        expected,
        actual: channels,
        smoke_marker: matchedRule.config.smokeMarker,
      },
      { status: 400 }
    );
  }

  if (tpl.send_mode !== 'scheduled') {
    return jsonRes(
      {
        ok: false,
        error: 'send_mode_must_be_scheduled',
        actual: tpl.send_mode,
      },
      { status: 400 }
    );
  }

  // status may be 'scheduled' (#5) OR 'sent' from a previous failed forced run (#4).
  // Both are acceptable here because force_execute path picks by id, not by status.
  if (!['scheduled', 'sent'].includes(tpl.status)) {
    return jsonRes(
      {
        ok: false,
        error: 'invalid_status',
        actual: tpl.status,
        allowed: ['scheduled', 'sent'],
      },
      { status: 400 }
    );
  }

  // Audience resolution sanity check
  const { data: audSystem, error: audErr } = await adminClient.rpc(
    'resolve_broadcast_audience_user_ids_system',
    { _filters: tpl.audience_filters || {} }
  );
  if (audErr) {
    return jsonRes(
      { ok: false, error: 'audience_resolution_failed', detail: audErr.message },
      { status: 500 }
    );
  }
  const audienceRows = (audSystem || []) as Array<{
    user_id: string;
    has_telegram: boolean;
    has_email: boolean;
  }>;
  const audCount = audienceRows.length;
  if (audCount < 1) {
    return jsonRes(
      { ok: false, error: 'empty_audience', audience_count: 0 },
      { status: 400 }
    );
  }

  // ===== Delegate to process-scheduled-broadcasts via system-actor path =====
  // We call the dispatcher with force_execute=true + force_template_id + force_secret.
  // Secret is taken from env and never exposed in response.
  const dispatcherUrl = `${supabaseUrl}/functions/v1/process-scheduled-broadcasts`;

  const dispatchResp = await fetch(dispatcherUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      force_execute: true,
      force_template_id: forceTemplateId,
      force_secret: forceSecret,
    }),
  });

  let dispatchBody: unknown = null;
  try {
    dispatchBody = await dispatchResp.json();
  } catch {
    dispatchBody = { raw: await dispatchResp.text().catch(() => '') };
  }

  // Strip any echo of the secret if present (defensive — dispatcher does not echo it,
  // but we prevent leakage in case of future drift).
  if (dispatchBody && typeof dispatchBody === 'object') {
    const safe = JSON.parse(JSON.stringify(dispatchBody));
    delete (safe as Record<string, unknown>).force_secret;
    dispatchBody = safe;
  }

  return jsonRes({
    ok: dispatchResp.ok,
    status: dispatchResp.status,
    smoke_marker: matchedRule.config.smokeMarker,
    template_id: forceTemplateId,
    template_name: tpl.name,
    channels,
    audience_count: audCount,
    dispatcher_response: dispatchBody,
  }, { status: dispatchResp.ok ? 200 : 502 });
});
