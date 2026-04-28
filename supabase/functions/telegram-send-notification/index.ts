import { createClient } from 'npm:@supabase/supabase-js@2';
import { greetPrefix, greetSuffix } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// ===========================================================================
// SECURITY: Whitelist of message_types allowed for service_role invocations
// ===========================================================================
const SERVICE_ROLE_ALLOWED_MESSAGE_TYPES = [
  'card_not_suitable_for_autopay',
  'card_verification_failed',
  'access_revoked',
  'access_still_active_apology',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ===========================================================================
    // AUTH: Detect service_role invocation vs user invocation
    // ===========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Check if this is a service_role invocation (system-to-system)
    const isServiceInvocation = token === supabaseServiceKey;
    
    let actorUserId: string | null = null;
    let actorLabel = 'system';

    if (!isServiceInvocation) {
      // User authentication path
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check permissions for user calls
      const { data: hasPermission } = await supabase.rpc('has_permission', {
        _user_id: user.id,
        _permission_code: 'entitlements.manage',
      });

      if (!hasPermission) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      actorUserId = user.id;
      actorLabel = user.email || user.id;
    } else {
      console.log('[telegram-send-notification] Service role invocation detected');
    }

    const body = await req.json();
    const { user_id, message_type, custom_message, payment_method_meta, reply_markup } = body;

    console.log(`[telegram-send-notification] Starting: user_id=${user_id}, type=${message_type}, isService=${isServiceInvocation}`);

    if (!user_id || !message_type) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing required parameters: user_id and message_type' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===========================================================================
    // SECURITY: For service_role, only allow whitelisted message_types
    // ===========================================================================
    if (isServiceInvocation) {
      if (!SERVICE_ROLE_ALLOWED_MESSAGE_TYPES.includes(message_type)) {
        console.log(`[telegram-send-notification] BLOCKED: service_role tried non-whitelisted type: ${message_type}`);
        
        await supabase.from('audit_logs').insert({
          action: 'telegram.notification.blocked',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            reason: 'message_type_not_whitelisted',
            message_type,
            invocation: 'service_role',
          }
        });

        return new Response(JSON.stringify({ 
          success: false, 
          error: `message_type '${message_type}' is not allowed for service invocations` 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =================================================================
    // PATCH 10A: Guard для access_revoked — проверяем реальный доступ
    // =================================================================
    if (message_type === 'access_revoked') {
      // Проверяем subscriptions_v2 (основной источник истины)
      const { data: activeSub } = await supabase
        .from('subscriptions_v2')
        .select('id, status, access_end_at')
        .eq('user_id', user_id)
        .in('status', ['active', 'trial', 'past_due'])
        .gt('access_end_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      // Также проверяем telegram_access (если есть активный доступ там)
      const { data: activeAccess } = await supabase
        .from('telegram_access')
        .select('id, active_until')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .gt('active_until', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (activeSub || activeAccess) {
        const accessEndAt = activeSub?.access_end_at || activeAccess?.active_until;
        const accessEndFormatted = new Date(accessEndAt).toLocaleDateString('ru-RU');
        
        console.log(`[BLOCKED] access_revoked for user ${user_id}: active access until ${accessEndAt}`);
        
        // Записываем в notification_outbox со статусом blocked (PATCH 10C)
        const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
        const idempotencyKey = `${user_id}:${message_type}:${bucket}`;
        
        // Insert into outbox (ignore duplicate key errors)
        const { error: blockOutboxError } = await supabase.from('notification_outbox').insert({
          user_id,
          message_type,
          idempotency_key: idempotencyKey,
          source: isServiceInvocation ? 'system' : 'manual',
          status: 'blocked',
          blocked_reason: 'active_access_exists',
          meta: {
            subscription_id: activeSub?.id,
            telegram_access_id: activeAccess?.id,
            access_end_at: accessEndAt,
            attempted_by_admin: actorUserId,
          }
        });
        // Ignore duplicate key errors (23505) - this is expected for repeated attempts
        if (blockOutboxError && blockOutboxError.code !== '23505') {
          console.log(`[notification_outbox] Insert error: ${blockOutboxError.message}`);
        }

        // Логируем BLOCKED в audit_logs
        await supabase.from('audit_logs').insert({
          action: 'notifications.send_blocked',
          actor_type: isServiceInvocation ? 'system' : 'user',
          actor_user_id: actorUserId,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            notification_type: message_type,
            reason: 'active_access_exists',
            subscription_id: activeSub?.id,
            subscription_status: activeSub?.status,
            telegram_access_id: activeAccess?.id,
            access_end_at: accessEndAt,
            attempted_by_admin: actorUserId,
            source: isServiceInvocation ? 'system' : 'manual',
            invocation: isServiceInvocation ? 'service_role' : 'user',
          }
        });

        return new Response(JSON.stringify({ 
          success: false, 
          blocked: true,
          error: `Отправка запрещена: доступ активен до ${accessEndFormatted}`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =================================================================
    // PATCH 10B + 10C: Idempotency через notification_outbox
    // PATCH A: For card_* types, include payment_method_id + verification_version
    // =================================================================
    const bucket = Math.floor(Date.now() / 1000); // 1-sec dedup window (anti-doubleclick only)
    
    // Build idempotency key based on message_type
    let idempotencyKey: string;
    
    if (SERVICE_ROLE_ALLOWED_MESSAGE_TYPES.includes(message_type) && payment_method_meta?.id) {
      // For card_* types: include payment_method_id + verification_version
      // verification_version = verification_checked_at (passed in meta) OR current timestamp bucket
      const verificationVersion = payment_method_meta.verification_checked_at || bucket;
      idempotencyKey = `${user_id}:${message_type}:${payment_method_meta.id}:${verificationVersion}`;
      console.log(`[telegram-send-notification] Card idempotency key: ${idempotencyKey}`);
    } else {
      // Default: time-based bucket
      idempotencyKey = `${user_id}:${message_type}:${bucket}`;
    }

    // Атомарная проверка через INSERT в notification_outbox
    const { error: outboxInsertError } = await supabase
      .from('notification_outbox')
      .insert({
        user_id,
        message_type,
        idempotency_key: idempotencyKey,
        source: isServiceInvocation ? 'system' : 'manual',
        status: 'queued',
        meta: { 
          attempted_by: actorUserId,
          invocation: isServiceInvocation ? 'service_role' : 'user',
          payment_method_meta,
          // PATCH B: Explicitly store payment_method_id as separate key for dedup queries
          payment_method_id: payment_method_meta?.id || null,
        }
      });

    // =================================================================
    // PATCH 10G: Умная обработка дубликатов — разрешаем retry для failed/blocked
    // =================================================================
    if (outboxInsertError?.code === '23505') { // Unique constraint violation
      console.log(`[DEDUP] Checking existing outbox entry for ${idempotencyKey}`);
      
      // Читаем существующую запись
      const { data: existingOutbox } = await supabase
        .from('notification_outbox')
        .select('id, status, attempt_count, blocked_reason')
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existingOutbox?.status === 'sent') {
        // Реально отправлено — skip
        console.log(`[DEDUP] Already sent, skipping`);
        
        await supabase.from('audit_logs').insert({
          action: 'notifications.outbox_skipped',
          actor_type: isServiceInvocation ? 'system' : 'user',
          actor_user_id: actorUserId,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            notification_type: message_type,
            reason: 'already_sent',
            idempotency_key: idempotencyKey,
            attempted_by_admin: actorUserId,
            invocation: isServiceInvocation ? 'service_role' : 'user',
          }
        });

        return new Response(JSON.stringify({ 
          success: false, 
          skipped: true,
          error: 'Уведомление уже отправлено в последние 10 минут'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (existingOutbox?.status === 'failed' || existingOutbox?.status === 'blocked') {
        // Была ошибка — разрешаем retry
        console.log(`[RETRY] Previous attempt was ${existingOutbox.status}, allowing retry`);
        
        const newAttemptCount = (existingOutbox.attempt_count || 1) + 1;
        
        await supabase.from('notification_outbox')
          .update({ 
            status: 'queued', 
            attempt_count: newAttemptCount,
            last_attempt_at: new Date().toISOString(),
            meta: { 
              retry_at: new Date().toISOString(),
              previous_status: existingOutbox.status,
              previous_reason: existingOutbox.blocked_reason,
              attempted_by: actorUserId,
              invocation: isServiceInvocation ? 'service_role' : 'user',
            }
          })
          .eq('id', existingOutbox.id);

        await supabase.from('audit_logs').insert({
          action: 'notifications.outbox_retry',
          actor_type: isServiceInvocation ? 'system' : 'user',
          actor_user_id: actorUserId,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            notification_type: message_type,
            previous_status: existingOutbox.status,
            attempt_count: newAttemptCount,
            idempotency_key: idempotencyKey,
            invocation: isServiceInvocation ? 'service_role' : 'user',
          }
        });

        // Продолжаем отправку (не return, идём дальше)
      } else if (existingOutbox?.status === 'queued') {
        // В процессе — skip
        console.log(`[DEDUP] Already queued/processing, skipping`);
        
        return new Response(JSON.stringify({ 
          success: false, 
          skipped: true,
          error: 'Уведомление уже обрабатывается'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =================================================================
    // Get user profile with telegram_user_id
    // =================================================================
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_username, full_name')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile?.telegram_user_id) {
      // Update outbox status to failed
      await supabase.from('notification_outbox')
        .update({ status: 'failed', blocked_reason: 'no_telegram_linked' })
        .eq('idempotency_key', idempotencyKey);
        
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'User has no Telegram linked' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get subscription info (for message templates)
    const { data: subscription } = await supabase
      .from('subscriptions_v2')
      .select('id, status, access_end_at')
      .eq('user_id', user_id)
      .in('status', ['active', 'trial', 'past_due'])
      .order('access_end_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get telegram access - check ALL access records, not just active ones
    const { data: access } = await supabase
      .from('telegram_access')
      .select('*, telegram_clubs(club_name, bot_id, telegram_bots(bot_token_encrypted))')
      .eq('user_id', user_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Find a bot token to use
    let botToken: string | null = null;
    let botId: string | null = null;
    let clubName = 'клубе';
    let clubId: string | null = null;

    if (access?.telegram_clubs) {
      const club = access.telegram_clubs as any;
      botToken = club.telegram_bots?.bot_token_encrypted;
      botId = club.bot_id ?? null;
      clubName = club.club_name || 'клубе';
      clubId = (access as any).club_id ?? null;
    }

    // If no access record, try to find any active bot
    if (!botToken) {
      const { data: anyClub } = await supabase
        .from('telegram_clubs')
        .select('id, club_name, bot_id, telegram_bots(bot_token_encrypted)')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (anyClub) {
        const club = anyClub as any;
        botToken = club.telegram_bots?.bot_token_encrypted;
        botId = club.bot_id ?? null;
        clubName = club.club_name || 'клубе';
        clubId = club.id ?? null;
      }
    }

    console.log(`[telegram-send-notification] user_id=${user_id}, message_type=${message_type}, botToken=${botToken ? 'found' : 'null'}, clubName=${clubName}`);

    if (!botToken) {
      console.log('[telegram-send-notification] No bot token found');
      await supabase.from('notification_outbox')
        .update({ status: 'failed', blocked_reason: 'no_bot_configured' })
        .eq('idempotency_key', idempotencyKey);
        
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No active Telegram bot configured' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // Prepare message based on type
    // =================================================================
    let message = '';
    const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
    const pricingUrl = `${siteUrl}/#pricing`;
    
    const accessEndFormatted = subscription?.access_end_at 
      ? new Date(subscription.access_end_at).toLocaleDateString('ru-RU')
      : null;

    // Extract card info from payment_method_meta if provided (for service invocations)
    const cardBrand = payment_method_meta?.brand?.toUpperCase() || '';
    const cardLast4 = payment_method_meta?.last4 || '';
    const cardDisplay = cardBrand && cardLast4 ? `${cardBrand} ****${cardLast4}` : 'вашу карту';
    
    // PATCH NAME-V: безопасное обращение по имени.
    // namePrefix = "Имя, " либо "" — НИКОГДА не подставляет фамилию.
    const namePrefix = greetPrefix(profile);

    // ===========================================================================
    // SECURITY: For service_role, IGNORE custom_message and use deterministic templates
    // Все шаблоны — обращение строго на «Вы».
    // ===========================================================================
    const messageTemplates: Record<string, string> = {
      reminder_3_days: `⏰ Небольшое напоминание

${namePrefix}ваша подписка в ${clubName} заканчивается через 3 дня.

Чтобы не потерять доступ к чату и материалам, просто продлите её заранее 💙`,
      
      reminder_1_day: `⚠️ Важное напоминание

${namePrefix}ваша подписка в ${clubName} заканчивается завтра!

Продлите сейчас, чтобы не потерять доступ 💙`,
      
      access_granted: `✅ Доступ восстановлен!

${namePrefix}ваша подписка в ${clubName} активна${accessEndFormatted ? ` до ${accessEndFormatted}` : ''}.

Добро пожаловать! 💙`,
      
      access_revoked: `❌ Доступ к клубу закрыт

${namePrefix}ваш доступ к ${clubName} был отозван, поэтому доступ к чату и каналу временно закрыт.

Вы можете вернуться в любой момент, оформив подписку 👇`,

      // PATCH 10E: Шаблон извинения за ложный access_revoked
      access_still_active_apology: `✅ Ваш доступ активен!

${namePrefix}приносим извинения за техническую ошибку — Вы могли получить ошибочное сообщение об отзыве доступа.

На самом деле ваша подписка в ${clubName} активна${accessEndFormatted ? ` до ${accessEndFormatted}` : ''}.

Всё работает, доступ открыт! 💙`,

      // PATCH 9 → PATCH-MIT: Шаблон для legacy карт (без призывов к токенизации)
      legacy_card_notification: `⚠️ Обновление платёжной системы

${namePrefix}ваша сохранённая карта была удалена из личного кабинета.

Для продления подписки оплатите на сайте:
🔗 ${siteUrl}/purchases`,

      // PATCH-MIT: Card with 3DS — нейтральный текст без обещаний автосписаний
      card_not_suitable_for_autopay: `ℹ️ Информация о карте

${namePrefix}ваша карта ${cardDisplay} успешно добавлена.

Оплата этой картой может требовать подтверждения 3D-Secure.

Для продления подписки Вы всегда можете оплатить на сайте:
🔗 ${siteUrl}/purchases`,

      // SECURE TEMPLATE: Card verification failed (temporary error, not 3DS rejection)
      card_verification_failed: `⚠️ Не удалось проверить карту

${namePrefix}мы попытались проверить ${cardDisplay} для автоматических платежей, но произошла ошибка.

Это может быть временная проблема с банком или платёжной системой.

💡 Что делать:
• Попробуйте позже (кнопка "Перепроверить" в настройках)
• Или привяжите другую карту

🔗 Настройки карт: ${siteUrl}/settings/payment-methods`,
      
      welcome: `👋 Здравствуйте${greetSuffix(profile)}!

Рады видеть Вас в ${clubName}!

Если возникнут вопросы — мы всегда на связи 💙`,
      
      // For user invocations, custom_message is allowed
      custom: isServiceInvocation ? 'Сообщение от системы.' : (custom_message || 'Сообщение от администратора клуба.'),
    };

    // For service invocations with whitelisted types, ALWAYS use template (ignore custom_message)
    if (isServiceInvocation && SERVICE_ROLE_ALLOWED_MESSAGE_TYPES.includes(message_type)) {
      message = messageTemplates[message_type];
      console.log(`[telegram-send-notification] Using secure template for ${message_type}`);
    } else {
      message = messageTemplates[message_type] || messageTemplates.custom;
    }

    // Prepare keyboard — use reply_markup from body if provided, otherwise default logic
    const keyboard = reply_markup
      ? reply_markup
      : (message_type === 'access_revoked' || message_type === 'reminder_3_days' || message_type === 'reminder_1_day')
        ? { inline_keyboard: [[{ text: '💳 Продлить подписку', url: pricingUrl }]] }
        : undefined;

    // Send message — Markdown by default for bold/italic in admin templates.
    // If Telegram rejects entities (rare special chars), retry as plain text so
    // the message is never lost.
    const sendPayload = {
      chat_id: profile.telegram_user_id,
      text: message,
      reply_markup: keyboard,
    };
    let usedParseMode: 'Markdown' | null = 'Markdown';
    let sendResult = await telegramRequest(botToken, 'sendMessage', {
      ...sendPayload,
      parse_mode: 'Markdown',
    });
    if (!sendResult?.ok && typeof sendResult?.description === 'string' &&
        /can't parse entities|can't find end/i.test(sendResult.description)) {
      console.warn('[telegram-send-notification] Markdown parse failed, retrying as plain text:', sendResult.description);
      usedParseMode = null;
      sendResult = await telegramRequest(botToken, 'sendMessage', sendPayload);
    }

    // Mirror to admin chat (Contact Center) — only if buttons exist & message accepted by Telegram
    const wasMirroredToMessages = !!(sendResult?.ok && sendResult?.result?.message_id && keyboard);
    if (wasMirroredToMessages) {
      await logAutomatedTelegramMessage({
        supabase,
        user_id,
        telegram_user_id: profile.telegram_user_id,
        bot_id: botId,
        text: message,
        telegram_message_id: sendResult.result.message_id,
        reply_markup: keyboard,
        source: 'telegram-send-notification',
        extra_meta: {
          message_type,
          club_id: clubId,
          idempotency_key: idempotencyKey,
          parse_mode: usedParseMode,
        },
      });
    }

    // Update notification_outbox status
    const outboxStatus = sendResult.ok ? 'sent' : 'failed';
    await supabase.from('notification_outbox')
      .update({ 
        status: outboxStatus,
        sent_at: sendResult.ok ? new Date().toISOString() : null,
        blocked_reason: sendResult.ok ? null : sendResult.description,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('idempotency_key', idempotencyKey);

    // =================================================================
    // SYSTEM ACTOR audit for service_role invocations
    // =================================================================
    await supabase.from('audit_logs').insert({
      action: sendResult.ok ? 'telegram.notification.sent' : 'telegram.notification.failed',
      actor_type: isServiceInvocation ? 'system' : 'user',
      actor_user_id: actorUserId,
      actor_label: isServiceInvocation ? 'telegram-send-notification' : actorLabel,
      target_user_id: user_id,
      meta: {
        notification_type: message_type,
        telegram_user_id: profile.telegram_user_id,
        idempotency_key: idempotencyKey,
        error: sendResult.ok ? null : sendResult.description,
        invocation: isServiceInvocation ? 'service_role' : 'user',
        template_used: isServiceInvocation && SERVICE_ROLE_ALLOWED_MESSAGE_TYPES.includes(message_type),
        payment_method_meta: isServiceInvocation ? payment_method_meta : undefined,
      }
    });

    // Log the notification in telegram_logs (audit/analytics row).
    // If the same outgoing message is already mirrored as a bubble in
    // telegram_messages, DO NOT duplicate `message_text` here — otherwise the
    // admin Contact Center renders both a bubble and an event-pill with the
    // same text. Failed/skipped sends still keep the text for diagnostics.
    await supabase
      .from('telegram_logs')
      .insert({
        user_id: user_id,
        action: message_type,
        target: 'user',
        status: sendResult.ok ? 'success' : 'error',
        error_message: sendResult.ok ? null : sendResult.description,
        message_text: wasMirroredToMessages ? null : message,
        meta: {
          invocation: isServiceInvocation ? 'service_role' : 'user',
          sent_by: isServiceInvocation ? 'system' : actorUserId,
          idempotency_key: idempotencyKey,
          payment_method_id: payment_method_meta?.id,
          last4: payment_method_meta?.last4,
          brand: payment_method_meta?.brand,
          mirrored_to_telegram_messages: wasMirroredToMessages,
          telegram_message_id: sendResult?.result?.message_id ?? null,
          parse_mode: usedParseMode,
        }
      });

    // Legacy audit log for backwards compatibility (user actor only for manual)
    if (!isServiceInvocation) {
      await supabase
        .from('audit_logs')
        .insert({
          action: sendResult.ok ? 'notifications.send_success' : 'notifications.send_error',
          actor_type: 'user',
          actor_user_id: actorUserId,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            notification_type: message_type,
            telegram_user_id: profile.telegram_user_id,
            success: sendResult.ok,
            error: sendResult.ok ? null : sendResult.description,
            idempotency_key: idempotencyKey,
            source: 'manual'
          }
        });
    }

    return new Response(JSON.stringify({ 
      success: sendResult.ok,
      error: sendResult.ok ? null : sendResult.description
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send notification error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
