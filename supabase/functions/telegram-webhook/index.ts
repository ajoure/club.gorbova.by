import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string };
    chat: { id: number; type: string; title?: string };
    date: number;
    text?: string;
    caption?: string;
    photo?: object[];
    video?: object;
    document?: object;
    reply_to_message?: { message_id: number };
  };
  message_reaction?: {
    chat: { id: number; type: string };
    message_id: number;
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
    actor_chat?: { id: number };
    date: number;
    old_reaction: Array<{ type: string; emoji?: string; custom_emoji_id?: string }>;
    new_reaction: Array<{ type: string; emoji?: string; custom_emoji_id?: string }>;
  };
  my_chat_member?: {
    chat: { id: number; title?: string; type: string };
    from: { id: number };
    new_chat_member: { status: string; user: { id: number } };
  };
  chat_member?: {
    chat: { id: number; title?: string; type: string };
    from: { id: number };
    old_chat_member: { status: string; user: { id: number; first_name?: string; last_name?: string; username?: string } };
    new_chat_member: { status: string; user: { id: number; first_name?: string; last_name?: string; username?: string } };
    invite_link?: { invite_link: string; name?: string; creator?: { id: number } };
    date: number;
  };
  chat_join_request?: {
    chat: { id: number; title?: string; type: string };
    from: { id: number; first_name: string; last_name?: string; username?: string };
    user_chat_id: number;
    date: number;
    invite_link?: { invite_link: string; name?: string; creator?: { id: number } };
  };
}

// Club branding
const CLUB_LOGO_URL = 'https://gorbova.lovable.app/images/club-logo.png';

const MESSAGES = {
  welcome: `👋 <b>Добро пожаловать в клуб «Буква закона»!</b>\n\nЗдесь вы найдёте материалы, продукты и поддержку по вопросам бизнеса и законодательства.\n\nЧерез меня вы получите доступ к закрытому каналу и чату клуба ✨`,
  accessGranted: `✅ <b>Всё отлично!</b>\n\nВаша подписка активна, я уже открыл вам доступ 🙌\n\nДобро пожаловать в клуб «Буква закона» 💙`,
  accessWithLinks: `✅ <b>Подписка активна!</b>\n\nЯ подготовил для вас доступ в клуб «Буква закона».\n⚠️ Ссылки одноразовые — лучше открыть сразу.`,
  noSubscription: `🔒 <b>Доступ закрыт</b>\n\nСейчас у вас нет активной подписки, поэтому я не могу добавить вас в клуб.\n\nКак только подписка будет оформлена — доступ появится автоматически 💫`,
  notLinked: `🤝 <b>Давайте познакомимся</b>\n\nЧтобы я мог добавить вас в чат и канал, нужно связать ваш Telegram с аккаунтом клуба.\n\nПросто нажмите кнопку ниже 👇`,
  linkSuccess: `✅ <b>Telegram успешно привязан!</b>\n\nТеперь я могу управлять вашим доступом к клубу «Буква закона».`,
  linkExpired: `❌ <b>Ссылка устарела</b>\n\nЭта ссылка для привязки уже не действует.\n\nПожалуйста, сгенерируйте новую в личном кабинете.`,
  alreadyLinked: `ℹ️ Этот Telegram уже привязан к другому аккаунту.\n\nЕсли это ошибка — обратитесь к администратору.`,
  joinApproved: `✅ <b>Заявка одобрена!</b>\n\nДобро пожаловать в клуб «Буква закона» 💙`,
  joinDeclined: `❌ <b>Заявка отклонена</b>\n\nУ вас нет активного доступа в клуб.\n\nОформите подписку, чтобы получить доступ 👇`,
  error: `⚠️ <b>Что-то пошло не так</b>\n\nПопробуйте чуть позже или напишите администратору 💬`,
};

// ============================================================
// AUDIT-SHAPE MODE (add-only, fail-closed)
// ----------------------------------------------------------------
// Activated ONLY when ALL three conditions are true:
//   1) Request header `x-audit-shape-secret` equals env AUDIT_SHAPE_SECRET (non-empty)
//   2) Request body contains object field `_audit_shape_meta`
//   3) AUDIT_SHAPE_SECRET env is set
// While active:
//   - All Telegram HTTP calls (api.telegram.org, helpers, anywhere) become no-ops
//     returning { ok: true, result: { audit_shape: true, method, params } }.
//   - All Supabase mutations (insert/update/upsert/delete/storage/rpc) become no-ops
//     EXCEPT inserts into the canonical audit table `telegram_access_audit`.
//   - Audit inserts are forced to carry meta.test=true, meta.dry_run=true,
//     meta.source='audit_shape_runtime'.
// Without a valid mode, behaviour is byte-for-byte identical to before.
// ============================================================
const AUDIT_SHAPE_ALLOWED_AUDIT_TABLE = 'telegram_access_audit';
let __AUDIT_SHAPE_ACTIVE = false;
let __AUDIT_SHAPE_META: Record<string, unknown> | null = null;
const __auditShapeBlockedCalls: Array<{ kind: string; detail: unknown }> = [];

function isAuditShapeActive(): boolean {
  return __AUDIT_SHAPE_ACTIVE === true;
}

function recordAuditShapeBlock(kind: string, detail: unknown) {
  if (__auditShapeBlockedCalls.length < 200) {
    __auditShapeBlockedCalls.push({ kind, detail });
  }
}

function makeAuditShapeTelegramResponse(method: string, params: unknown) {
  return {
    ok: true,
    result: {
      audit_shape: true,
      method,
      params,
      message: 'audit_shape_runtime: telegram call suppressed',
    },
  };
}

// Wrapped Supabase client. All read paths are unchanged; write paths are gated.
function wrapSupabaseForAuditShape(realClient: any) {
  const blockChain = (table: string, op: string) => {
    recordAuditShapeBlock('supabase_mutation', { table, op });
    return Promise.resolve({ data: null, error: null, status: 200, statusText: 'audit_shape_noop', count: null });
  };
  const makeNoopBuilder = (table: string, op: string) => {
    const builder: any = {};
    const chainable = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or', 'match', 'order', 'limit', 'single', 'maybeSingle', 'returns'];
    for (const m of chainable) builder[m] = () => builder;
    builder.then = (resolve: any) => resolve({ data: null, error: null, status: 200, statusText: 'audit_shape_noop', count: null });
    builder.__auditShapeNoop = true;
    // Terminal awaits resolve via .then
    return builder;
  };

  return new Proxy(realClient, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          const realQb = target.from(table);
          if (table === AUDIT_SHAPE_ALLOWED_AUDIT_TABLE) {
            // Allow audit writes, but force meta fields on insert
            return new Proxy(realQb, {
              get(qbTarget, qbProp, qbRecv) {
                if (qbProp === 'insert') {
                  return (rows: any) => {
                    const stamp = (row: any) => {
                      const meta = (row && typeof row === 'object' && row.meta && typeof row.meta === 'object') ? row.meta : {};
                      return {
                        ...row,
                        meta: { ...meta, test: true, dry_run: true, source: 'audit_shape_runtime' },
                      };
                    };
                    const stamped = Array.isArray(rows) ? rows.map(stamp) : stamp(rows);
                    return qbTarget.insert(stamped);
                  };
                }
                return Reflect.get(qbTarget, qbProp, qbRecv);
              },
            });
          }
          // Non-audit table: wrap mutators as no-ops, leave reads intact
          return new Proxy(realQb, {
            get(qbTarget, qbProp, qbRecv) {
              if (qbProp === 'insert' || qbProp === 'update' || qbProp === 'upsert' || qbProp === 'delete') {
                return (..._args: any[]) => {
                  recordAuditShapeBlock('supabase_mutation', { table, op: String(qbProp) });
                  return makeNoopBuilder(table, String(qbProp));
                };
              }
              return Reflect.get(qbTarget, qbProp, qbRecv);
            },
          });
        };
      }
      if (prop === 'rpc') {
        return (fn: string, args: any) => {
          recordAuditShapeBlock('supabase_rpc', { fn, args });
          return Promise.resolve({ data: null, error: null, status: 200, statusText: 'audit_shape_noop' });
        };
      }
      if (prop === 'storage') {
        const realStorage = target.storage;
        return new Proxy(realStorage, {
          get(stTarget, stProp) {
            if (stProp === 'from') {
              return (bucket: string) => {
                const realBucket = stTarget.from(bucket);
                return new Proxy(realBucket, {
                  get(bkTarget, bkProp) {
                    if (bkProp === 'upload' || bkProp === 'remove' || bkProp === 'move' || bkProp === 'copy' || bkProp === 'createSignedUrl') {
                      return (..._args: any[]) => {
                        recordAuditShapeBlock('storage_mutation', { bucket, op: String(bkProp) });
                        return Promise.resolve({ data: null, error: null });
                      };
                    }
                    return Reflect.get(bkTarget, bkProp);
                  },
                });
              };
            }
            return Reflect.get(stTarget, stProp);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  if (isAuditShapeActive()) {
    recordAuditShapeBlock('telegram_api', { method, params });
    return makeAuditShapeTelegramResponse(method, params);
  }
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// Audit-shape aware fetch for direct api.telegram.org calls (photos, getFile, file/).
async function telegramFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isAuditShapeActive() && /api\.telegram\.org/.test(input)) {
    recordAuditShapeBlock('telegram_fetch', { url: input });
    const body = JSON.stringify({ ok: true, result: { audit_shape: true, url: input } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fetch(input, init);
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendMessage', body);
}

// Send photo with caption - for branded welcome messages
async function sendPhotoWithCaption(botToken: string, chatId: number, photoUrl: string, caption: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { 
    chat_id: chatId, 
    photo: photoUrl, 
    caption, 
    parse_mode: 'HTML' 
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendPhoto', body);
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
}

// Fetch and save Telegram profile photo
async function fetchAndSaveTelegramPhoto(
  supabase: any,
  botToken: string,
  telegramUserId: number,
  userId: string
): Promise<string | null> {
  try {
    const photosResponse = await telegramFetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramUserId}&limit=1`
    );
    const photosData = await photosResponse.json();

    if (!photosData.ok || !photosData.result?.photos?.[0]?.[0]) {
      console.log('No profile photo found for user', telegramUserId);
      return null;
    }

    const photo = photosData.result.photos[0][0];
    const fileId = photo.file_id;

    const fileResponse = await telegramFetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      console.log('Failed to get file path');
      return null;
    }

    const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const photoResponse = await telegramFetch(photoUrl);
    const photoBlob = await photoResponse.arrayBuffer();

    const fileName = `avatars/${userId}_telegram_${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, photoBlob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('Failed to upload photo:', uploadError);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);

    const avatarUrl = urlData?.publicUrl;

    if (avatarUrl) {
      await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('user_id', userId);
    }

    return avatarUrl;
  } catch (error) {
    console.error('Error fetching Telegram photo:', error);
    return null;
  }
}

// Check if user has active access to the club
async function hasActiveAccess(supabase: any, userId: string, clubId: string): Promise<boolean> {
  const now = new Date();

  // Check telegram_access
  const { data: access } = await supabase
    .from('telegram_access')
    .select('active_until, state_chat, state_channel')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .single();

  if (access && access.state_chat !== 'revoked' && access.state_channel !== 'revoked') {
    const activeUntil = access.active_until ? new Date(access.active_until) : null;
    if (!activeUntil || activeUntil > now) return true;
  }

  // Check manual access
  const { data: manual } = await supabase
    .from('telegram_manual_access')
    .select('is_active, valid_until')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('is_active', true)
    .single();

  if (manual) {
    const validUntil = manual.valid_until ? new Date(manual.valid_until) : null;
    if (!validUntil || validUntil > now) return true;
  }

  // Check access grants
  const { data: grant } = await supabase
    .from('telegram_access_grants')
    .select('status, end_at')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('status', 'active')
    .single();

  if (grant) {
    const endAt = grant.end_at ? new Date(grant.end_at) : null;
    if (!endAt || endAt > now) return true;
  }

  return false;
}

// Log audit event
async function logAudit(supabase: any, event: any) {
  await supabase.from('telegram_access_audit').insert(event);
}

// ==========================================
// AI SUPPORT INTEGRATION HELPER
// ==========================================
interface AIInvokeParams {
  telegramUserId: number;
  messageText: string;
  botId: string;
  messageId: number;
  botToken: string;
  chatId: number;
  profileUserId: string;
}

async function invokeAISupport(supabase: any, params: AIInvokeParams) {
  try {
    // Check if AI is enabled for this bot (master switch + auto_reply)
    const { data: settings } = await supabase
      .from('ai_bot_settings')
      .select('bot_enabled, toggles, hold_ai_when_handoff_open')
      .eq('bot_id', params.botId)
      .maybeSingle();
    
    // Master switch: bot_enabled
    if (settings?.bot_enabled === false) {
      console.log('[AI Support] Bot disabled via master switch for bot', params.botId);
      return; // Входящие сообщения уже сохранены в БД, просто не отвечаем
    }
    
    const toggles = settings?.toggles;
    if (!toggles?.auto_reply_enabled) {
      console.log('[AI Support] Auto-reply disabled for bot', params.botId);
      return;
    }
    
    // Check if hold_ai_when_handoff_open is enabled
    const holdAiWhenHandoff = settings?.hold_ai_when_handoff_open ?? true;
    
    // Check for active handoff
    const { data: activeHandoff } = await supabase
      .from('ai_handoffs')
      .select('id')
      .eq('telegram_user_id', params.telegramUserId)
      .eq('bot_id', params.botId)
      .in('status', ['open', 'waiting_human'])
      .maybeSingle();
    
    if (activeHandoff) {
      console.log('[AI Support] Active handoff exists, skipping AI');
      return;
    }
    
    // Invoke telegram-ai-support function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const response = await fetch(`${supabaseUrl}/functions/v1/telegram-ai-support`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        telegramUserId: params.telegramUserId,
        messageText: params.messageText,
        botId: params.botId,
        messageId: params.messageId,
        chatId: params.chatId,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Support] Function error:', response.status, errorText);
      return;
    }
    
    const data = await response.json();
    console.log('[AI Support] Response:', JSON.stringify(data));
    
    // Send reply if AI generated one
    if (data?.reply) {
      const sendResult = await sendMessage(params.botToken, params.chatId, data.reply);
      console.log('[AI Support] Message sent:', sendResult?.ok);
      
      // Save outgoing AI message to telegram_messages
      if (sendResult?.ok && sendResult?.result?.message_id) {
        await supabase.from('telegram_messages').insert({
          user_id: params.profileUserId,
          telegram_user_id: params.telegramUserId,
          bot_id: params.botId,
          direction: 'outgoing',
          message_text: data.reply,
          message_id: sendResult.result.message_id,
          status: 'sent',
          meta: {
            ai_generated: true,
            intent: data.intent,
            confidence: data.confidence,
            used_tools: data.used_tools,
          },
        });
      }
    }
  } catch (err) {
    console.error('[AI Support] Error:', err);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Reset audit-shape state per invocation (fail-closed)
  __AUDIT_SHAPE_ACTIVE = false;
  __AUDIT_SHAPE_META = null;
  __auditShapeBlockedCalls.length = 0;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const realSupabase = createClient(supabaseUrl, supabaseServiceKey);
    let supabase: any = realSupabase;

    const url = new URL(req.url);
    const botId = url.searchParams.get('bot_id');

    // Read body ONCE (audit-shape detection needs body, classic flow needs body)
    const rawBody: any = await req.json().catch(() => null);

    // -------- Audit-shape detection (fail-closed) --------
    const auditShapeSecretEnv = Deno.env.get('AUDIT_SHAPE_SECRET') || '';
    const auditShapeHeader = req.headers.get('x-audit-shape-secret') || '';
    const hasAuditMeta = !!(rawBody && typeof rawBody === 'object' && rawBody._audit_shape_meta && typeof rawBody._audit_shape_meta === 'object');
    const headerProvided = auditShapeHeader.length > 0;
    const requestedAuditShape = hasAuditMeta || headerProvided;
    let auditShapeRunId: string | null = null;

    if (requestedAuditShape) {
      const secretOk = auditShapeSecretEnv.length > 0 && auditShapeHeader === auditShapeSecretEnv;
      const allOk = secretOk && hasAuditMeta;
      const meta = (rawBody && rawBody._audit_shape_meta) || {};
      const scenario = typeof meta?.scenario === 'string' ? meta.scenario : null;
      const actorUserId = typeof meta?.actor_user_id === 'string' ? meta.actor_user_id : null;

      // Log run attempt via REAL (unwrapped) client — even on denial.
      try {
        const { data: runRow } = await realSupabase
          .from('telegram_audit_shape_runs')
          .insert({
            actor_user_id: actorUserId || '00000000-0000-0000-0000-000000000000',
            scenario: scenario || 'INVITE_USED', // CHECK constraint allows only known scenarios
            status: allOk ? 'ok' : 'denied',
            meta: {
              reason: allOk ? 'accepted' : (secretOk ? 'missing_audit_meta' : 'bad_or_missing_secret'),
              had_header: headerProvided,
              had_audit_meta: hasAuditMeta,
              bot_id: botId,
              raw_meta: meta,
            },
          })
          .select('id')
          .single();
        auditShapeRunId = runRow?.id || null;
      } catch (logErr) {
        console.error('[audit-shape] failed to record run', logErr);
      }

      if (!allOk) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'audit_shape_denied',
          reason: secretOk ? 'missing_audit_meta' : 'bad_or_missing_secret',
          run_id: auditShapeRunId,
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      __AUDIT_SHAPE_ACTIVE = true;
      __AUDIT_SHAPE_META = meta;
      supabase = wrapSupabaseForAuditShape(realSupabase);
      console.log('[audit-shape] ACTIVE', { scenario, actorUserId, runId: auditShapeRunId });
    }
    // -----------------------------------------------------

    if (!botId) {
      // Healthcheck / monitoring pings may call webhook without bot_id.
      if (rawBody && typeof rawBody === 'object' && rawBody.ping === true) {
        return new Response(JSON.stringify({ ok: true, pong: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.error('No bot_id provided');
      return new Response(JSON.stringify({ ok: false, error: 'No bot_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: bot, error: botError } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('id', botId)
      .eq('status', 'active')
      .maybeSingle();

    if (botError) {
      console.error('Bot query error:', botError);
      return new Response(JSON.stringify({ ok: false, error: 'db_error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!bot) {
      console.error('Bot not found for id:', botId);
      return new Response(JSON.stringify({ ok: false, error: 'bot_not_found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = bot.bot_token_encrypted;
    const update: TelegramUpdate = rawBody as TelegramUpdate;

    console.log('Telegram update:', JSON.stringify(update, null, 2));

    // ==========================================
    // Handle chat_join_request - CRITICAL FOR SECURITY
    // ==========================================
    if (update.chat_join_request) {
      const joinRequest = update.chat_join_request;
      const telegramUserId = joinRequest.from.id;
      const chatId = joinRequest.chat.id;
      const chatType = joinRequest.chat.type;

      console.log(`Join request from ${telegramUserId} to chat ${chatId}`);

      // Find which club this chat belongs to
      const { data: club } = await supabase
        .from('telegram_clubs')
        .select('id, club_name, join_request_mode')
        .eq('bot_id', botId)
        .or(`chat_id.eq.${chatId},channel_id.eq.${chatId}`)
        .single();

      if (!club) {
        console.log('No club found for chat', chatId);
        // Decline unknown chat requests
        await telegramRequest(botToken, 'declineChatJoinRequest', { chat_id: chatId, user_id: telegramUserId });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Find user by telegram_user_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, user_id')
        .eq('telegram_user_id', telegramUserId)
        .single();

      let approved = false;
      let userId: string | null = profile?.user_id || null;

      if (profile && userId) {
        // Check if user has active access
        approved = await hasActiveAccess(supabase, userId, club.id);
      }

      if (approved) {
        // Approve join request
        const approveResult = await telegramRequest(botToken, 'approveChatJoinRequest', {
          chat_id: chatId,
          user_id: telegramUserId,
        });

        console.log('Approve result:', approveResult);

        // Update member record
        const isChat = chatType === 'supergroup' || chatType === 'group';
        await supabase.from('telegram_club_members').upsert({
          club_id: club.id,
          telegram_user_id: telegramUserId,
          telegram_username: joinRequest.from.username,
          telegram_first_name: joinRequest.from.first_name,
          telegram_last_name: joinRequest.from.last_name,
          profile_id: profile?.id,
          link_status: profile ? 'linked' : 'not_linked',
          access_status: 'ok',
          in_chat: isChat ? true : undefined,
          in_channel: !isChat ? true : undefined,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'club_id,telegram_user_id' });

        // Log audit
        await logAudit(supabase, {
          club_id: club.id,
          user_id: userId,
          telegram_user_id: telegramUserId,
          event_type: 'JOIN_APPROVED',
          actor_type: 'system',
          telegram_chat_result: approveResult,
          meta: { chat_id: chatId, chat_type: chatType },
        });

        // Send welcome DM
        await sendMessage(botToken, telegramUserId, MESSAGES.joinApproved);
      } else {
        // Decline join request
        const declineResult = await telegramRequest(botToken, 'declineChatJoinRequest', {
          chat_id: chatId,
          user_id: telegramUserId,
        });

        console.log('Decline result:', declineResult);

        // Log audit
        await logAudit(supabase, {
          club_id: club.id,
          user_id: userId,
          telegram_user_id: telegramUserId,
          event_type: 'JOIN_DECLINED',
          actor_type: 'system',
          reason: profile ? 'no_active_access' : 'telegram_not_linked',
          telegram_chat_result: declineResult,
          meta: { chat_id: chatId },
        });

        // Send decline DM with subscription link
        const keyboard = {
          inline_keyboard: [[{ text: '💳 Оформить подписку', url: `${getSiteUrl()}/#pricing` }]],
        };
        await sendMessage(botToken, telegramUserId, MESSAGES.joinDeclined, keyboard);
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // Handle /start command
    // ==========================================
    if (update.message?.text?.startsWith('/start')) {
      const telegramUserId = update.message.from.id;
      const telegramUsername = update.message.from.username;
      const telegramFirstName = update.message.from.first_name;
      const telegramLastName = update.message.from.last_name;
      const chatId = update.message.chat.id;
      const text = update.message.text;
      
      const parts = text.split(' ');
      if (parts.length > 1) {
        const param = parts[1];
        
        // Handle link token
        const { data: tokenData, error: tokenError } = await supabase
          .from('telegram_link_tokens')
          .select('*')
          .eq('token', param)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .single();

        if (!tokenError && tokenData) {
          // Check if telegram already linked to another account
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id, user_id')
            .eq('telegram_user_id', telegramUserId)
            .single();

          if (existingProfile && existingProfile.user_id !== tokenData.user_id) {
            await sendMessage(botToken, chatId, MESSAGES.alreadyLinked);
            return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }

          // Link telegram account with new status fields
          await supabase.from('profiles').update({
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            telegram_linked_at: new Date().toISOString(),
            telegram_link_status: 'active',
            telegram_link_bot_id: tokenData.bot_id || botId,
            telegram_last_check_at: new Date().toISOString(),
            telegram_last_error: null,
          }).eq('user_id', tokenData.user_id);

          // Mark token as confirmed
          await supabase.from('telegram_link_tokens').update({
            used_at: new Date().toISOString(),
            status: 'confirmed',
          }).eq('id', tokenData.id);

          // Log to telegram_logs
          await supabase.from('telegram_logs').insert({
            user_id: tokenData.user_id,
            action: tokenData.action_type === 'relink' ? 'RELINK_SUCCESS' : 'LINK_SUCCESS',
            target: 'profile',
            status: 'ok',
            meta: { telegram_user_id: telegramUserId, telegram_username: telegramUsername },
          });

          // Log to audit
          await supabase.from('telegram_access_audit').insert({
            user_id: tokenData.user_id,
            telegram_user_id: telegramUserId,
            event_type: tokenData.action_type === 'relink' ? 'telegram_relink' : 'telegram_link_confirmed',
            actor_type: 'user',
            meta: { telegram_username: telegramUsername, bot_id: botId },
          });

          await sendMessage(botToken, chatId, MESSAGES.linkSuccess);

          // Auto-fetch and save Telegram profile photo
          try {
            await fetchAndSaveTelegramPhoto(supabase, botToken, telegramUserId, tokenData.user_id);
            console.log('Profile photo fetched for user', tokenData.user_id);
          } catch (photoError) {
            console.error('Failed to fetch profile photo:', photoError);
          }

          // ============================================================
          // CRITICAL: Process PENDING orders that were waiting for Telegram link
          // ============================================================
          console.log('Checking for pending orders after Telegram link...');
          
          const { data: pendingOrders } = await supabase
            .from('orders_v2')
            .select(`
              id, 
              order_number,
              product_id,
              tariff_id,
              offer_id,
              customer_email,
              customer_phone,
              final_price,
              meta,
              products_v2!inner(name, telegram_club_id),
              tariffs!inner(name, code, getcourse_offer_id, access_days)
            `)
            .eq('user_id', tokenData.user_id)
            .eq('status', 'paid')
            .not('meta->gc_sync_pending', 'is', null);

          console.log(`Found ${pendingOrders?.length || 0} pending orders to process`);

          for (const order of pendingOrders || []) {
            try {
              const product = (order as any).products_v2;
              const tariff = (order as any).tariffs;
              const orderMeta = (order.meta as Record<string, any>) || {};
              
              console.log(`Processing pending order ${order.order_number}...`);
              
              // 1. Grant Telegram access if product has club
              if (product?.telegram_club_id) {
                console.log('Granting Telegram access for pending order');
                await supabase.functions.invoke('telegram-grant-access', {
                  body: {
                    user_id: tokenData.user_id,
                    club_id: product?.telegram_club_id || null,
                    source_id: order.id,
                    source: 'telegram_link_pending',
                    duration_days: tariff?.access_days || 30,
                  },
                });
              }
              
              // 2. Sync to GetCourse if configured
              const getcourseOfferId = tariff?.getcourse_offer_id;
              if (getcourseOfferId && order.customer_email) {
                console.log(`Syncing pending order to GetCourse: offer_id=${getcourseOfferId}`);
                
                // Call test-getcourse-sync or send directly
                await supabase.functions.invoke('test-getcourse-sync', {
                  body: { orderId: order.id },
                });
              }
              
              // 3. Mark order as synced (remove pending flags)
              await supabase
                .from('orders_v2')
                .update({
                  meta: {
                    ...orderMeta,
                    gc_sync_pending: null,
                    telegram_access_pending: null,
                    synced_at: new Date().toISOString(),
                    synced_trigger: 'telegram_link',
                  }
                })
                .eq('id', order.id);
              
              console.log(`Order ${order.order_number} synced successfully after Telegram link`);
            } catch (orderErr) {
              console.error(`Error processing pending order ${order.id}:`, orderErr);
            }
          }
          
          // Clear pending notifications about Telegram linking
          await supabase
            .from('pending_telegram_notifications')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('user_id', tokenData.user_id)
            .eq('notification_type', 'telegram_link_required')
            .eq('status', 'pending');

          // Check subscription and grant access (v2 first, then legacy) for other subscriptions
          let hasActiveSubscription = false;
          
          // Check subscriptions_v2 first
          const { data: subV2 } = await supabase
            .from('subscriptions_v2')
            .select('id, order_id')
            .eq('user_id', tokenData.user_id)
            .in('status', ['active', 'trial'])
            .gte('access_end_at', new Date().toISOString())
            .limit(1)
            .maybeSingle();

          if (subV2) {
            hasActiveSubscription = true;
            // Resolve club_id from subscription's product
            const { data: subProduct } = await supabase
              .from('subscriptions_v2')
              .select('product_id, products_v2!inner(telegram_club_id)')
              .eq('id', subV2.id)
              .maybeSingle();
            const subClubId = (subProduct?.products_v2 as any)?.telegram_club_id || null;
            
            await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: tokenData.user_id,
                club_id: subClubId,
                source_id: subV2.order_id,
                source: 'telegram_link',
              },
            });
          } else {
            // Fallback to legacy subscriptions table
            const { data: subscription } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('user_id', tokenData.user_id)
              .eq('is_active', true)
              .gte('expires_at', new Date().toISOString())
              .single();

            if (subscription) {
              hasActiveSubscription = true;
              // Legacy subscriptions path — skip without club_id (legacy data lacks product context)
              console.warn('[TELEGRAM] Legacy subscription path: no club_id resolvable, skipping grant');
              // await supabase.functions.invoke('telegram-grant-access', { body: { user_id: tokenData.user_id } });
            }
          }

          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Token expired or invalid
        if (param.length > 10) {
          await sendMessage(botToken, chatId, MESSAGES.linkExpired);
          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // Regular /start - send branded welcome with logo, then check user status
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (!profile) {
        // New user - send logo + welcome + link buttons
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔗 Привязать Telegram', url: `${getSiteUrl()}/dashboard` }],
            [{ text: '💳 Оформить подписку', url: `${getSiteUrl()}/#pricing` }],
          ],
        };
        // Send welcome with logo
        await sendPhotoWithCaption(botToken, chatId, CLUB_LOGO_URL, MESSAGES.welcome, keyboard);
      } else {
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', profile.user_id)
          .eq('is_active', true)
          .single();

        if (subscription?.expires_at && new Date(subscription.expires_at) > new Date()) {
          // Active subscription - send logo + access granted
          await sendPhotoWithCaption(botToken, chatId, CLUB_LOGO_URL, MESSAGES.accessGranted);
        } else {
          // No subscription - send logo + no subscription message
          const keyboard = {
            inline_keyboard: [[{ text: '💳 Оформить подписку', url: `${getSiteUrl()}/#pricing` }]],
          };
          await sendPhotoWithCaption(botToken, chatId, CLUB_LOGO_URL, MESSAGES.noSubscription, keyboard);
        }
      }
    }

    // ==========================================
    // Handle regular messages - save for analytics
    // ==========================================
    if (update.message && !update.message.text?.startsWith('/')) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const chatType = msg.chat.type;

      // Save private messages to telegram_messages for admin chat history
      if (chatType === 'private') {
        const telegramUserId = msg.from.id;
        
        // Find user by telegram_user_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, user_id')
          .eq('telegram_user_id', telegramUserId)
          .single();
        
        if (profile?.user_id) {
          // Determine file info if present
          let fileType: string | null = null;
          let fileName: string | null = null;
          let fileId: string | null = null;
          let fileUrl: string | null = null;
          const msgAny = msg as any;
          
          if (msgAny.photo && msgAny.photo.length > 0) {
            fileType = 'photo';
            fileName = 'photo.jpg';
            // Get the largest photo (last in array)
            fileId = msgAny.photo[msgAny.photo.length - 1].file_id;
          } else if (msgAny.video) {
            fileType = 'video';
            fileName = msgAny.video?.file_name || 'video.mp4';
            fileId = msgAny.video.file_id;
          } else if (msgAny.video_note) {
            fileType = 'video_note';
            fileName = 'video_note.mp4';
            fileId = msgAny.video_note.file_id;
          } else if (msgAny.audio) {
            fileType = 'audio';
            fileName = msgAny.audio?.file_name || 'audio.mp3';
            fileId = msgAny.audio.file_id;
          } else if (msgAny.voice) {
            fileType = 'voice';
            fileName = 'voice.ogg';
            fileId = msgAny.voice.file_id;
          } else if (msgAny.document) {
            fileType = 'document';
            fileName = msgAny.document?.file_name || 'file';
            fileId = msgAny.document.file_id;
          } else if (msgAny.sticker) {
            fileType = 'sticker';
            fileName = msgAny.sticker?.emoji || 'sticker';
            fileId = msgAny.sticker.file_id;
          }
          
          // ========== TWO-PHASE FAIL-OPEN PATTERN ==========
          // Phase 1: INSERT immediately with pending status
          // Phase 2: Upload file, then UPDATE meta
          
          const webhookStartTime = Date.now();
          let webhookStage = 'parsed';
          let webhookError: string | null = null;
          
          // Initialize all variables at top scope
          let storageBucket: string | null = null;
          let storagePath: string | null = null;
          let contentType: string | null = null;
          let uploadedFileSize: number | null = null;
          let dbMessageId: string | null = null;
          
          // Safe filename sanitizer with try/catch
          const safeSanitizeFileName = (name: string, defaultExt?: string): string => {
            try {
              if (!name) return 'file' + (defaultExt || '');
              const lastDot = name.lastIndexOf('.');
              const ext = lastDot > 0 ? name.slice(lastDot).toLowerCase() : (defaultExt || '');
              const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
              
              const cyrToLat: Record<string, string> = {
                'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
                'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
                'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
                'э':'e','ю':'yu','я':'ya'
              };
              
              let safe = baseName.toLowerCase();
              for (const [cyr, lat] of Object.entries(cyrToLat)) {
                safe = safe.replace(new RegExp(cyr, 'g'), lat);
              }
              
              safe = safe.replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '').replace(/_+/g, '_').slice(0, 100);
              return (safe || 'file') + ext;
            } catch {
              return 'file' + (defaultExt || '');
            }
          };

          // PHASE 1: IMMEDIATE INSERT with pending status
          const baseMeta = {
            file_type: fileType || null,
            file_name: fileName || null,
            file_id: fileId || null,
            mime_type: null,
            file_size: null,
            storage_bucket: null,
            storage_path: null,
            upload_status: fileId ? 'pending' : null,
            webhook_stage: 'inserted',
            raw: msg
          };
          
          try {
            webhookStage = 'inserting';
            const { data: insertedMsg, error: insertError } = await supabase
              .from('telegram_messages')
              .insert({
                user_id: profile.user_id,
                telegram_user_id: telegramUserId,
                bot_id: botId,
                direction: 'incoming',
                message_text: msg.text || msg.caption || null,
                message_id: msg.message_id,
                reply_to_message_id: msg.reply_to_message?.message_id || null,
                status: 'sent',
                meta: baseMeta
              })
              .select('id')
              .single();
            
            if (insertError) {
              console.error('[WEBHOOK] Phase 1 insert failed:', insertError);
              webhookError = String(insertError.message || insertError);
            } else {
              dbMessageId = insertedMsg?.id || null;
              webhookStage = 'inserted';
              console.log(`[WEBHOOK] Phase 1: Inserted message ${msg.message_id} as ${dbMessageId}`);
            }
          } catch (insertErr) {
            console.error('[WEBHOOK] Phase 1 exception:', insertErr);
            webhookError = String(insertErr);
          }

          // ========== HOTFIX: EARLY RETURN ==========
          // Return IMMEDIATELY to Telegram after Phase 1 INSERT
          // File processing will be done by async worker (media_jobs queue)
          // This prevents Telegram webhook timeouts
          
          const webhookMs = Date.now() - webhookStartTime;
          console.log(`[WEBHOOK] Early ACK for message ${msg.message_id}, dbId: ${dbMessageId}, file pending: ${!!fileId}, ms: ${webhookMs}`);
          
          // Queue media job if file present (BEFORE return)
          if (fileId && dbMessageId && botId) {
            try {
              await supabase.from("media_jobs").insert({
                message_db_id: dbMessageId,
                user_id: profile.user_id,
                bot_id: botId,
                telegram_file_id: fileId,
                file_type: fileType,
                file_name: fileName,
              });

              // Update meta.upload_status='pending' (merge with existing)
              const prev = baseMeta || {};
              await supabase.from("telegram_messages")
                .update({ meta: { ...prev, upload_status: "pending", webhook_stage: "queued" } })
                .eq("id", dbMessageId);
                
              console.log(`[WEBHOOK] Media job queued for ${dbMessageId}`);
            } catch (qErr) {
              console.error("[WEBHOOK] queue media_jobs failed:", qErr);
            }
          }
          
          // ========== SUPPORT TICKET BRIDGE (TG → Ticket) ==========
          // If user has an active bridged ticket, create a ticket_message
          try {
            const { data: bridgedTicket } = await supabase
              .from('support_tickets')
              .select('id')
              .eq('telegram_bridge_enabled', true)
              .eq('telegram_user_id', telegramUserId)
              .not('status', 'in', '("closed","resolved")')
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (bridgedTicket) {
              // Check if this is a feedback ticket — skip inbound for feedback
              const { data: feedbackCtx } = await supabase
                .from('ticket_training_context')
                .select('id')
                .eq('ticket_id', bridgedTicket.id)
                .limit(1)
                .maybeSingle();

              if (feedbackCtx) {
                console.log('[BRIDGE] skip inbound for feedback ticket:', bridgedTicket.id);
              } else {
              const msgText = msg.text || msg.caption || '[медиа]';
              
              // Get profile full_name for author_name
              const { data: authorProfile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('user_id', profile.user_id)
                .single();

              const { data: insertedTicketMsg } = await supabase
                .from('ticket_messages')
                .insert({
                  ticket_id: bridgedTicket.id,
                  author_id: profile.user_id,
                  author_type: 'user',
                  author_name: authorProfile?.full_name || null,
                  message: msgText,
                  is_internal: false,
                  attachments: [],
                })
                .select('id')
                .single();

              if (insertedTicketMsg) {
                // Record sync
                await supabase.from('ticket_telegram_sync').insert({
                  ticket_id: bridgedTicket.id,
                  ticket_message_id: insertedTicketMsg.id,
                  telegram_message_id: msg.message_id,
                  direction: 'from_telegram',
                });

                // Mark ticket as having unread for admin
                await supabase
                  .from('support_tickets')
                  .update({ has_unread_admin: true, updated_at: new Date().toISOString() })
                  .eq('id', bridgedTicket.id);
              }

              console.log(`[BRIDGE] TG message ${msg.message_id} → ticket ${bridgedTicket.id}`);
              } // end else (not feedback)
            }
          } catch (bridgeErr) {
            console.error('[BRIDGE] Error:', bridgeErr);
          }

          // ========== AI SUPPORT INTEGRATION ==========
          // Invoke AI support for text messages (non-blocking)
          if (msg.text && !fileId) {
            invokeAISupport(supabase, {
              telegramUserId,
              messageText: msg.text,
              botId,
              messageId: msg.message_id,
              botToken,
              chatId,
              profileUserId: profile.user_id,
            }).catch(err => console.error('[AI Support] Invocation error:', err));
          }

          // ========== PUSH NOTIFICATIONS TO ADMINS ==========
          // Send browser push to all admins with support.view permission
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            
            // Get admin user IDs (super_admin role or support.view permission)
            const { data: adminRoles } = await supabase
              .from('user_roles_v2')
              .select('user_id, roles!inner(code)')
              .in('roles.code', ['super_admin', 'admin']);
            
            const adminUserIds = [...new Set((adminRoles || []).map((r: any) => r.user_id))];
            
            if (adminUserIds.length > 0) {
              const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Пользователь';
              const msgPreview = (msg.text || msg.caption || '[медиа]').slice(0, 100);
              
              fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  user_ids: adminUserIds,
                  title: `💬 ${senderName}`,
                  body: msgPreview,
                  url: '/admin/communication',
                  tag: `tg-msg-${telegramUserId}`,
                }),
              }).catch(err => console.error('[Push] Send error:', err));
            }
          } catch (pushErr) {
            console.error('[Push] Admin notification error:', pushErr);
          }

          // Best-effort audit log (non-blocking)
          Promise.resolve(
            supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'telegram-webhook',
              action: 'webhook_message_received',
              meta: {
                message_id: msg.message_id,
                db_message_id: dbMessageId,
                telegram_user_id: telegramUserId,
                stage: webhookStage,
                ms: webhookMs,
                has_file: !!fileId,
                file_type: fileType,
                upload_status: fileId ? 'pending' : null,
                error: webhookError
              }
            })
          ).then(() => {
            console.log('[WEBHOOK] Audit log written');
          }).catch((err: unknown) => {
            console.error('[WEBHOOK] Audit log failed:', err);
          });
          
          // IMMEDIATE RETURN - don't block on file processing
          return new Response(JSON.stringify({ ok: true, fast_ack: true }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
          
          // ========== PHASE 2: DISABLED ==========
          // File upload moved to async worker (telegram-media-worker)
          // This entire block is now unreachable - kept for reference only
          /*
          if (fileId && botToken && dbMessageId) {
            // ... file upload code disabled ...
          }
          */
        }
      }

      // Group/supergroup messages for analytics
      if (chatType === 'supergroup' || chatType === 'group') {
        // Find club for this chat with analytics enabled
        const { data: club } = await supabase
          .from('telegram_clubs')
          .select('id, chat_analytics_enabled')
          .eq('bot_id', botId)
          .eq('chat_id', chatId)
          .single();

        if (club?.chat_analytics_enabled) {
          const displayName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
          const hasMedia = !!(msg.photo || msg.video || msg.document);
          const text = msg.text || msg.caption || null;

          await supabase.from('tg_chat_messages').upsert({
            club_id: club.id,
            chat_id: chatId,
            message_id: msg.message_id,
            message_ts: new Date(msg.date * 1000).toISOString(),
            from_tg_user_id: msg.from.id,
            from_display_name: displayName || null,
            text,
            has_media: hasMedia,
            reply_to_message_id: msg.reply_to_message?.message_id || null,
            raw_payload: msg,
          }, { onConflict: 'club_id,message_id' });

          console.log(`Saved message ${msg.message_id} for analytics in club ${club.id}`);
        }
      }
    }

    // ==========================================
    // Handle chat_member (user joined/left chat) — PATCH P0.9.8
    // ==========================================
    if (update.chat_member) {
      const cm = update.chat_member;
      const telegramUserId = cm.new_chat_member.user.id;
      const chatId = cm.chat.id;
      const chatType = cm.chat.type;
      const newStatus = cm.new_chat_member.status;
      const oldStatus = cm.old_chat_member.status;

      console.log(`[chat_member] User ${telegramUserId} in ${chatType} ${chatId}: ${oldStatus} -> ${newStatus}`);

      // Find club by chat_id or channel_id
      const { data: club } = await supabase
        .from('telegram_clubs')
        .select('id')
        .eq('bot_id', botId)
        .or(`chat_id.eq.${chatId},channel_id.eq.${chatId}`)
        .maybeSingle();

      if (club) {
        // Determine if this is chat or channel
        const isChat = chatType === 'supergroup' || chatType === 'group';
        const isJoin = ['member', 'administrator', 'creator'].includes(newStatus) && ['left', 'kicked', 'restricted'].includes(oldStatus);
        const isLeave = ['left', 'kicked'].includes(newStatus) && ['member', 'administrator', 'creator'].includes(oldStatus);

        if (isJoin) {
          // User JOINED
          const updateFields: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
            last_verified_at: new Date().toISOString(),
          };
          if (isChat) {
            updateFields.in_chat = true;
            updateFields.verified_in_chat_at = new Date().toISOString();
          } else {
            updateFields.in_channel = true;
            updateFields.verified_in_channel_at = new Date().toISOString();
          }

          await supabase.from('telegram_club_members')
            .update(updateFields)
            .eq('club_id', club.id)
            .eq('telegram_user_id', telegramUserId);

          // Try to match invite link
          if (cm.invite_link?.invite_link) {
            const inviteUrl = cm.invite_link.invite_link;
            const plusMatch = inviteUrl.match(/\+([A-Za-z0-9_-]+)$/);
            const joinMatch = inviteUrl.match(/joinchat\/([A-Za-z0-9_-]+)$/);
            const inviteCode = plusMatch?.[1] || joinMatch?.[1] || null;

            if (inviteCode) {
              // v5.3: select all matching codes (any status) to detect cross-club + reuse
              const { data: anyByCode } = await supabase
                .from('telegram_invite_links')
                .select('id, telegram_user_id, profile_id, club_id, status, target_chat_id, expires_at')
                .eq('invite_code', inviteCode)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (anyByCode) {
                const baseMeta = {
                  club_id: club.id,
                  tg_id: telegramUserId,
                  expected_tg_id: anyByCode.telegram_user_id,
                  invite_link_id: anyByCode.id,
                  invite_code: inviteCode,
                  source_function: 'telegram-webhook',
                };

                // CROSS-CLUB guard: invite belongs to a different club
                if (anyByCode.club_id && anyByCode.club_id !== club.id) {
                  await logAudit(supabase, {
                    club_id: club.id,
                    telegram_user_id: telegramUserId,
                    event_type: 'INVITE_BLOCKED_CROSS_CLUB',
                    actor_type: 'system',
                    reason: 'invite_club_mismatch',
                    meta: { ...baseMeta, invite_club_id: anyByCode.club_id, decision: 'blocked' },
                  });
                } else if (anyByCode.status && !['created', 'sent'].includes(anyByCode.status)) {
                  // EXPIRED or REUSED — link not in active state
                  await logAudit(supabase, {
                    club_id: club.id,
                    telegram_user_id: telegramUserId,
                    event_type: 'INVITE_EXPIRED_OR_REUSED',
                    actor_type: 'system',
                    reason: `invite_status_${anyByCode.status}`,
                    meta: { ...baseMeta, prev_status: anyByCode.status, decision: 'blocked' },
                  });
                } else if (anyByCode.telegram_user_id && anyByCode.telegram_user_id !== telegramUserId) {
                  // MISMATCH: wrong tg_id used the personal link
                  await supabase.from('telegram_invite_links')
                    .update({ status: 'mismatch', used_at: new Date().toISOString(), used_by_telegram_user_id: telegramUserId })
                    .eq('id', anyByCode.id);

                  await logAudit(supabase, {
                    club_id: club.id,
                    telegram_user_id: telegramUserId,
                    event_type: 'INVITE_MISMATCH',
                    actor_type: 'system',
                    reason: 'expected_tg_id_mismatch',
                    meta: { ...baseMeta, actual_tg_id: telegramUserId, decision: 'mismatch' },
                  });
                } else {
                  // Successful match → INVITE_USED
                  await supabase.from('telegram_invite_links')
                    .update({ status: 'used', used_at: new Date().toISOString(), used_by_telegram_user_id: telegramUserId })
                    .eq('id', anyByCode.id);

                  await logAudit(supabase, {
                    club_id: club.id,
                    telegram_user_id: telegramUserId,
                    event_type: 'INVITE_USED',
                    actor_type: 'system',
                    reason: 'expected_tg_id_match',
                    meta: { ...baseMeta, decision: 'used' },
                  });
                }
              }
            }
          } else {
            // No invite_link in update — check profile mapping for weak mismatch
            const { data: memberRecord } = await supabase
              .from('telegram_club_members')
              .select('profile_id')
              .eq('club_id', club.id)
              .eq('telegram_user_id', telegramUserId)
              .maybeSingle();

            // If we have a profile linked to a different TG user, log weak mismatch
            if (memberRecord?.profile_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('telegram_user_id')
                .eq('id', memberRecord.profile_id)
                .maybeSingle();

              if (profile?.telegram_user_id && Number(profile.telegram_user_id) !== telegramUserId) {
                await logAudit(supabase, {
                  club_id: club.id,
                  telegram_user_id: telegramUserId,
                  event_type: 'INVITE_MISMATCH_WEAK',
                  actor_type: 'system',
                  meta: { expected_tg_id: profile.telegram_user_id, actual_tg_id: telegramUserId },
                });
              }
            }
          }

          await logAudit(supabase, {
            club_id: club.id,
            telegram_user_id: telegramUserId,
            event_type: 'JOIN_VERIFIED',
            actor_type: 'system',
            meta: { chat_id: chatId, chat_type: chatType, has_invite_link: !!cm.invite_link },
          });
        }

        if (isLeave) {
          // User LEFT or was KICKED
          const updateFields: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (isChat) {
            updateFields.in_chat = false;
            updateFields.verified_in_chat_at = null;
          } else {
            updateFields.in_channel = false;
            updateFields.verified_in_channel_at = null;
          }

          await supabase.from('telegram_club_members')
            .update(updateFields)
            .eq('club_id', club.id)
            .eq('telegram_user_id', telegramUserId);

          await logAudit(supabase, {
            club_id: club.id,
            telegram_user_id: telegramUserId,
            event_type: newStatus === 'kicked' ? 'MEMBER_KICKED' : 'MEMBER_LEFT',
            actor_type: 'system',
            meta: { chat_id: chatId, chat_type: chatType },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // Handle message_reaction (user reacted to a message)
    // ==========================================
    if (update.message_reaction) {
      const reaction = update.message_reaction;
      const chatId = reaction.chat.id;
      const telegramMessageId = reaction.message_id;
      const telegramUserId = reaction.user?.id || reaction.actor_chat?.id;

      if (telegramUserId && reaction.chat.type === 'private') {
        try {
          // Find the DB message by telegram message_id + telegram_user_id
          const { data: dbMsg } = await supabase
            .from('telegram_messages')
            .select('id, user_id')
            .eq('message_id', telegramMessageId)
            .eq('telegram_user_id', telegramUserId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (dbMsg) {
            // Determine added and removed emojis
            const oldEmojis = (reaction.old_reaction || [])
              .filter(r => r.type === 'emoji' && r.emoji)
              .map(r => r.emoji!);
            const newEmojis = (reaction.new_reaction || [])
              .filter(r => r.type === 'emoji' && r.emoji)
              .map(r => r.emoji!);

            const added = newEmojis.filter(e => !oldEmojis.includes(e));
            const removed = oldEmojis.filter(e => !newEmojis.includes(e));

            // Find profile user_id for the actual reactor (not message author)
            const { data: reactorProfile } = await supabase
              .from('profiles')
              .select('user_id')
              .eq('telegram_user_id', telegramUserId)
              .maybeSingle();

            if (!reactorProfile) {
              console.log(`[REACTION] unmapped_reactor: tg_user=${telegramUserId}, skipping`);
              return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }

            const reactorUserId = reactorProfile.user_id;

            // Remove reactions
            for (const emoji of removed) {
              await supabase
                .from('telegram_message_reactions')
                .delete()
                .eq('message_id', dbMsg.id)
                .eq('user_id', reactorUserId)
                .eq('emoji', emoji);
            }

            // Add reactions (upsert-safe via unique constraint)
            for (const emoji of added) {
              await supabase
                .from('telegram_message_reactions')
                .upsert(
                  {
                    message_id: dbMsg.id,
                    user_id: reactorUserId,
                    emoji,
                  },
                  { onConflict: 'message_id,user_id,emoji' }
                );
            }

            console.log(`[REACTION] tg_user=${telegramUserId} msg=${telegramMessageId} added=${added.join(',')} removed=${removed.join(',')}`);
          } else {
            console.log(`[REACTION] No DB message found for tg_msg_id=${telegramMessageId} tg_user=${telegramUserId}`);
          }
        } catch (reactionErr) {
          console.error('[REACTION] Error processing message_reaction:', reactionErr);
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // Handle my_chat_member (bot added to chat)
    // ==========================================
    if (update.my_chat_member) {
      const chatMember = update.my_chat_member;
      const chatType = chatMember.chat.type;
      const chatIdValue = chatMember.chat.id;
      const newStatus = chatMember.new_chat_member.status;

      console.log(`Bot status changed in ${chatType} ${chatIdValue}: ${newStatus}`);

      if (newStatus === 'administrator') {
        if (chatType === 'supergroup' || chatType === 'group') {
          await supabase.from('telegram_clubs').update({
            chat_id: chatIdValue,
            chat_status: 'active',
          }).eq('bot_id', botId).is('chat_id', null);
        } else if (chatType === 'channel') {
          await supabase.from('telegram_clubs').update({
            channel_id: chatIdValue,
            channel_status: 'active',
          }).eq('bot_id', botId).is('channel_id', null);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
