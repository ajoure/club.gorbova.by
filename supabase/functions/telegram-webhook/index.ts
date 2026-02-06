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
  my_chat_member?: {
    chat: { id: number; title?: string; type: string };
    from: { id: number };
    new_chat_member: { status: string; user: { id: number } };
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
  welcome: `👋 <b>Добро пожаловать в клуб «Буква закона»!</b>\n\nЗдесь вы найдёте материалы, продукты и поддержку по вопросам бизнеса и законодательства.\n\nЧерез меня ты получишь доступ к закрытому каналу и чату клуба ✨`,
  accessGranted: `✅ <b>Всё отлично!</b>\n\nТвоя подписка активна, я уже открыл тебе доступ 🙌\n\nДобро пожаловать в клуб «Буква закона» 💙`,
  accessWithLinks: `✅ <b>Подписка активна!</b>\n\nЯ подготовил для тебя доступ в клуб «Буква закона».\n⚠️ Ссылки одноразовые — лучше открыть сразу.`,
  noSubscription: `🔒 <b>Доступ закрыт</b>\n\nСейчас у тебя нет активной подписки, поэтому я не могу добавить тебя в клуб.\n\nКак только подписка будет оформлена — доступ появится автоматически 💫`,
  notLinked: `🤝 <b>Давай познакомимся</b>\n\nЧтобы я мог добавить тебя в чат и канал, нужно связать твой Telegram с аккаунтом клуба.\n\nПросто нажми кнопку ниже 👇`,
  linkSuccess: `✅ <b>Telegram успешно привязан!</b>\n\nТеперь я могу управлять твоим доступом к клубу «Буква закона».`,
  linkExpired: `❌ <b>Ссылка устарела</b>\n\nЭта ссылка для привязки уже не действует.\n\nПожалуйста, сгенерируй новую в личном кабинете.`,
  alreadyLinked: `ℹ️ Этот Telegram уже привязан к другому аккаунту.\n\nЕсли это ошибка — обратись к администратору.`,
  joinApproved: `✅ <b>Заявка одобрена!</b>\n\nДобро пожаловать в клуб «Буква закона» 💙`,
  joinDeclined: `❌ <b>Заявка отклонена</b>\n\nУ тебя нет активного доступа в клуб.\n\nОформи подписку, чтобы получить доступ 👇`,
  error: `⚠️ <b>Что-то пошло не так</b>\n\nПопробуй чуть позже или напиши администратору 💬`,
};

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
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
    const photosResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramUserId}&limit=1`
    );
    const photosData = await photosResponse.json();

    if (!photosData.ok || !photosData.result?.photos?.[0]?.[0]) {
      console.log('No profile photo found for user', telegramUserId);
      return null;
    }

    const photo = photosData.result.photos[0][0];
    const fileId = photo.file_id;

    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      console.log('Failed to get file path');
      return null;
    }

    const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
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
    // Check if AI is enabled for this bot
    const { data: settings } = await supabase
      .from('ai_bot_settings')
      .select('toggles')
      .eq('bot_id', params.botId)
      .maybeSingle();
    
    const toggles = settings?.toggles;
    if (!toggles?.auto_reply_enabled) {
      console.log('[AI Support] Auto-reply disabled for bot', params.botId);
      return;
    }
    
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const botId = url.searchParams.get('bot_id');
    
    if (!botId) {
      // Healthcheck / monitoring pings may call webhook without bot_id.
      // This must not be treated as an error, otherwise it can break the admin UI checks.
      const body = await req.json().catch(() => null) as any;
      if (body && typeof body === 'object' && body.ping === true) {
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
    const update: TelegramUpdate = await req.json();
    
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
                    duration_days: tariff?.access_days || 30,
                    source: 'telegram_link_pending',
                    source_id: order.id,
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
            await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: tokenData.user_id,
                source: 'telegram_link',
                source_id: subV2.order_id,
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
              await supabase.functions.invoke('telegram-grant-access', {
                body: { user_id: tokenData.user_id },
              });
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
