import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check permissions
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

    const body = await req.json();
    const { user_id, message_type, custom_message } = body;

    console.log(`[telegram-send-notification] Starting: user_id=${user_id}, type=${message_type}`);

    if (!user_id || !message_type) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing required parameters: user_id and message_type' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
          source: 'manual',
          status: 'blocked',
          blocked_reason: 'active_access_exists',
          meta: {
            subscription_id: activeSub?.id,
            telegram_access_id: activeAccess?.id,
            access_end_at: accessEndAt,
            attempted_by_admin: user.id,
          }
        });
        // Ignore duplicate key errors (23505) - this is expected for repeated attempts
        if (blockOutboxError && blockOutboxError.code !== '23505') {
          console.log(`[notification_outbox] Insert error: ${blockOutboxError.message}`);
        }

        // Логируем BLOCKED в audit_logs
        await supabase.from('audit_logs').insert({
          action: 'notifications.send_blocked',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'telegram-send-notification',
          target_user_id: user_id,
          meta: {
            notification_type: message_type,
            reason: 'active_access_exists',
            subscription_id: activeSub?.id,
            subscription_status: activeSub?.status,
            telegram_access_id: activeAccess?.id,
            access_end_at: accessEndAt,
            attempted_by_admin: user.id,
            source: 'manual'
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
    // =================================================================
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); // 10-минутные интервалы
    const idempotencyKey = `${user_id}:${message_type}:${bucket}`;

    // Атомарная проверка через INSERT в notification_outbox
    const { error: outboxInsertError } = await supabase
      .from('notification_outbox')
      .insert({
        user_id,
        message_type,
        idempotency_key: idempotencyKey,
        source: 'manual',
        status: 'queued',
        meta: { attempted_by: user.id }
      });

    if (outboxInsertError?.code === '23505') { // Unique constraint violation = duplicate
      console.log(`[DEDUP] Notification ${message_type} already processed for user ${user_id} in current window`);
      
      // Логируем SKIPPED в audit_logs
      await supabase.from('audit_logs').insert({
        action: 'notifications.send_skipped',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'telegram-send-notification',
        target_user_id: user_id,
        meta: {
          notification_type: message_type,
          reason: 'duplicate_idempotency_key',
          idempotency_key: idempotencyKey,
          window_minutes: 10,
          attempted_by_admin: user.id
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
    let clubName = 'клубе';

    if (access?.telegram_clubs) {
      const club = access.telegram_clubs as any;
      botToken = club.telegram_bots?.bot_token_encrypted;
      clubName = club.club_name || 'клубе';
    }

    // If no access record, try to find any active bot
    if (!botToken) {
      const { data: anyClub } = await supabase
        .from('telegram_clubs')
        .select('club_name, telegram_bots(bot_token_encrypted)')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (anyClub) {
        const club = anyClub as any;
        botToken = club.telegram_bots?.bot_token_encrypted;
        clubName = club.club_name || 'клубе';
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
    // Prepare message based on type (includes PATCH 10E: apology template)
    // =================================================================
    let message = '';
    const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
    const pricingUrl = `${siteUrl}/#pricing`;
    
    const accessEndFormatted = subscription?.access_end_at 
      ? new Date(subscription.access_end_at).toLocaleDateString('ru-RU')
      : null;
    
    const messageTemplates: Record<string, string> = {
      reminder_3_days: `⏰ Небольшое напоминание

Твоя подписка в ${clubName} заканчивается через 3 дня.

Чтобы не потерять доступ к чату и материалам, просто продли её заранее 💙`,
      
      reminder_1_day: `⚠️ Важное напоминание

Твоя подписка в ${clubName} заканчивается завтра!

Продли сейчас, чтобы не потерять доступ 💙`,
      
      access_granted: `✅ Всё отлично!

Твоя подписка активна, я уже открыл тебе доступ 🙌

Добро пожаловать в ${clubName} 💙`,
      
      access_revoked: `❌ Подписка завершена

Срок твоей подписки в ${clubName} истёк, поэтому доступ к чату и каналу временно закрыт.

Ты можешь в любой момент вернуться — просто продли подписку 👇`,

      // PATCH 10E: Шаблон извинения за ложный access_revoked
      access_still_active_apology: `✅ Ваш доступ активен!

Приносим извинения за техническую ошибку — вы могли получить ошибочное сообщение об отзыве доступа.

На самом деле ваша подписка в ${clubName} активна${accessEndFormatted ? ` до ${accessEndFormatted}` : ''}.

Всё работает, доступ открыт! 💙`,
      
      welcome: `👋 Привет${profile.full_name ? ', ' + profile.full_name : ''}!

Рады видеть тебя в ${clubName}!

Если возникнут вопросы — мы всегда на связи 💙`,
      
      custom: custom_message || 'Сообщение от администратора клуба.',
    };

    message = messageTemplates[message_type] || messageTemplates.custom;

    // Prepare keyboard
    const keyboard = message_type === 'access_revoked' || message_type === 'reminder_3_days' || message_type === 'reminder_1_day'
      ? { inline_keyboard: [[{ text: '💳 Продлить подписку', url: pricingUrl }]] }
      : undefined;

    // Send message
    const sendResult = await telegramRequest(botToken, 'sendMessage', {
      chat_id: profile.telegram_user_id,
      text: message,
      reply_markup: keyboard,
    });

    // Update notification_outbox status
    await supabase.from('notification_outbox')
      .update({ 
        status: sendResult.ok ? 'sent' : 'failed',
        sent_at: sendResult.ok ? new Date().toISOString() : null,
        blocked_reason: sendResult.ok ? null : sendResult.description,
      })
      .eq('idempotency_key', idempotencyKey);

    // Log the notification in telegram_logs
    await supabase
      .from('telegram_logs')
      .insert({
        user_id: user_id,
        action: 'manual_notification',
        target: 'user',
        status: sendResult.ok ? 'success' : 'error',
        error_message: sendResult.ok ? null : sendResult.description,
        meta: {
          message_type,
          sent_by_admin: user.id,
          idempotency_key: idempotencyKey,
        }
      });

    // Audit log with SYSTEM ACTOR proof
    await supabase
      .from('audit_logs')
      .insert({
        action: sendResult.ok ? 'notifications.send_success' : 'notifications.send_error',
        actor_type: 'user',
        actor_user_id: user.id,
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
