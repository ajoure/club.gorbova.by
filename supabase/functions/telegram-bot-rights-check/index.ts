// @ts-nocheck
// telegram-bot-rights-check
// Read-only по invite/access данным. Допустимая запись — только audit-событие
// BOT_RIGHTS_INSUFFICIENT в telegram_access_audit (служебный лог).
// Контракт v5.5:
//  - bot_id берётся через getMe() (НЕ хардкод, НЕ из БД).
//  - Проверяем can_invite_users + can_restrict_members.
//  - can_promote_members не требуется.
//  - Любой STOP → audit BOT_RIGHTS_INSUFFICIENT, возвращаем { ok:false, missing:[...] }.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  club_id: string;
}

interface AuditMeta {
  club_id: string;
  chat_id: number | null;
  bot_id: number | null;
  missing: string[];
  source_function: 'telegram-bot-rights-check';
  decision: 'blocked' | 'ok';
  reason: string;
  test: false;
}

const REQUIRED_RIGHTS = ['can_invite_users', 'can_restrict_members'] as const;

async function tg(botToken: string, method: string, params: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return await res.json();
}

async function writeAudit(
  supabase: any,
  meta: AuditMeta,
) {
  await supabase.from('telegram_access_audit').insert({
    club_id: meta.club_id,
    event_type: meta.decision === 'ok' ? 'BOT_RIGHTS_OK' : 'BOT_RIGHTS_INSUFFICIENT',
    actor_type: 'system',
    reason: meta.reason,
    meta,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const club_id = body?.club_id;
  if (!club_id || typeof club_id !== 'string') {
    return new Response(JSON.stringify({ error: 'club_id_required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Загружаем клуб + бота
  const { data: club, error: clubErr } = await supabase
    .from('telegram_clubs')
    .select('id, chat_id, bot_id, telegram_bots(bot_token_encrypted)')
    .eq('id', club_id)
    .maybeSingle();

  if (clubErr || !club) {
    return new Response(
      JSON.stringify({ error: 'club_not_found', detail: clubErr?.message }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const chatId = club.chat_id as number | null;
  const botToken = (club as any).telegram_bots?.bot_token_encrypted as string | undefined;

  if (!chatId) {
    const meta: AuditMeta = {
      club_id, chat_id: null, bot_id: null,
      missing: ['chat_id'],
      source_function: 'telegram-bot-rights-check',
      decision: 'blocked',
      reason: 'chat_id_missing',
      test: false,
    };
    await writeAudit(supabase, meta);
    return new Response(JSON.stringify({ ok: false, missing: meta.missing, reason: meta.reason }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!botToken) {
    const meta: AuditMeta = {
      club_id, chat_id: chatId, bot_id: null,
      missing: ['bot_token'],
      source_function: 'telegram-bot-rights-check',
      decision: 'blocked',
      reason: 'bot_token_missing',
      test: false,
    };
    await writeAudit(supabase, meta);
    return new Response(JSON.stringify({ ok: false, missing: meta.missing, reason: meta.reason }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. getMe — bot_id берётся ТОЛЬКО отсюда (контракт v5.5).
  const me = await tg(botToken, 'getMe', {});
  if (!me?.ok || !me.result?.id) {
    const meta: AuditMeta = {
      club_id, chat_id: chatId, bot_id: null,
      missing: ['bot_id'],
      source_function: 'telegram-bot-rights-check',
      decision: 'blocked',
      reason: 'getme_failed',
      test: false,
    };
    await writeAudit(supabase, meta);
    return new Response(
      JSON.stringify({ ok: false, missing: meta.missing, reason: meta.reason, raw: me }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const botId = me.result.id as number;

  // 2. getChatMember
  const cm = await tg(botToken, 'getChatMember', { chat_id: chatId, user_id: botId });
  if (!cm?.ok || !cm.result) {
    const meta: AuditMeta = {
      club_id, chat_id: chatId, bot_id: botId,
      missing: ['chat_member'],
      source_function: 'telegram-bot-rights-check',
      decision: 'blocked',
      reason: 'getchatmember_failed',
      test: false,
    };
    await writeAudit(supabase, meta);
    return new Response(
      JSON.stringify({ ok: false, missing: meta.missing, reason: meta.reason, raw: cm }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const member = cm.result;
  const missing: string[] = [];

  if (member.status !== 'administrator') {
    missing.push('status:administrator');
  } else {
    for (const right of REQUIRED_RIGHTS) {
      if (!member[right]) missing.push(right);
    }
  }

  if (missing.length > 0) {
    const meta: AuditMeta = {
      club_id, chat_id: chatId, bot_id: botId, missing,
      source_function: 'telegram-bot-rights-check',
      decision: 'blocked',
      reason: 'bot_rights_insufficient',
      test: false,
    };
    await writeAudit(supabase, meta);
    return new Response(
      JSON.stringify({ ok: false, missing, reason: meta.reason, raw: cm.result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // OK — bot имеет необходимые права.
  // Записываем подтверждающий audit (служебный, не writer бизнес-данных).
  const okMeta: AuditMeta = {
    club_id, chat_id: chatId, bot_id: botId, missing: [],
    source_function: 'telegram-bot-rights-check',
    decision: 'ok',
    reason: 'bot_rights_ok',
    test: false,
  };
  await writeAudit(supabase, okMeta);

  return new Response(
    JSON.stringify({ ok: true, missing: [], bot_id: botId, raw: cm.result }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
