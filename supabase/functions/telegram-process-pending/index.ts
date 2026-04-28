import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { greetSuffix } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  console.log(`Telegram API: ${method}`);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
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
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, user_id: providedUserId } = body;

    // Admin can process for specific user, regular users only for themselves
    const targetUserId = providedUserId || user.id;

    // Get user profile with telegram_user_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_username, full_name')
      .eq('user_id', targetUserId)
      .single();

    if (profileError || !profile?.telegram_user_id) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Telegram not linked',
        pending_count: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get pending notifications
    const { data: pendingNotifications, error: pendingError } = await supabase
      .from('pending_telegram_notifications')
      .select('*')
      .eq('user_id', targetUserId)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (pendingError) {
      console.error('Error fetching pending:', pendingError);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingNotifications?.length) {
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0,
        message: 'No pending notifications' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get bot token
    let botToken: string | null = null;
    let botId: string | null = null;

    // First try to get from club
    const { data: anyClub } = await supabase
      .from('telegram_clubs')
      .select('bot_id, telegram_bots(bot_token_encrypted)')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (anyClub) {
      const club = anyClub as any;
      botToken = club.telegram_bots?.bot_token_encrypted;
      botId = club.bot_id ?? null;
    }

    if (!botToken) {
      // Try to get from any active bot
      const { data: anyBot } = await supabase
        .from('telegram_bots')
        .select('id, bot_token_encrypted')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      
      botToken = anyBot?.bot_token_encrypted || null;
      botId = (anyBot as any)?.id ?? null;
    }

    if (!botToken) {
      console.error('No active bot found');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No active bot configured' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const telegramUserId = Number(profile.telegram_user_id);
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const notification of pendingNotifications) {
      try {
        const payload = notification.payload as Record<string, unknown>;
        
        let message = '';
        let keyboard: { inline_keyboard?: Array<Array<{ text: string; url: string }>> } | undefined;

        // Build message based on notification type
        switch (notification.notification_type) {
          case 'access_granted': {
            const chatLink = payload.chat_invite_link as string | undefined;
            const channelLink = payload.channel_invite_link as string | undefined;
            const validUntil = payload.valid_until as string | undefined;

            const validUntilText = validUntil
              ? `\n📅 Доступ активен до: ${new Date(validUntil).toLocaleDateString('ru-RU')}`
              : '';

            message = `✅ <b>Доступ открыт!</b>\n\nЯ подготовил для Вас ссылки для входа в клуб.${validUntilText}\n\n⚠️ <i>Ссылки одноразовые — переходите сейчас!</i>`;

            const buttons: Array<Array<{ text: string; url: string }>> = [];
            if (chatLink) buttons.push([{ text: '💬 Войти в чат клуба', url: chatLink }]);
            if (channelLink) buttons.push([{ text: '📣 Войти в канал клуба', url: channelLink }]);
            keyboard = { inline_keyboard: buttons };
          }

          case 'welcome': {
            message = `👋 Здравствуйте${greetSuffix(profile)}!\n\nРады видеть Вас! Если возникнут вопросы — мы всегда на связи 💙`;
            break;
          }

          case 'custom': {
            message = (payload.message as string) || 'Сообщение от администратора.';
            break;
          }

          default: {
            message = (payload.message as string) || 'У вас новое уведомление.';
          }
        }

        const sendResult = await sendMessage(botToken, telegramUserId, message, keyboard);

        if (sendResult.ok) {
          // Mirror to admin chat (Contact Center) — only when buttons exist & message_id present
          if (keyboard && sendResult?.result?.message_id) {
            await logAutomatedTelegramMessage({
              supabase,
              user_id: targetUserId,
              telegram_user_id: telegramUserId,
              bot_id: botId,
              text: message,
              telegram_message_id: sendResult.result.message_id,
              reply_markup: keyboard,
              source: 'telegram-process-pending',
              extra_meta: {
                notification_type: notification.notification_type,
                notification_id: notification.id,
              },
            });
          }

          // Mark as sent
          await supabase
            .from('pending_telegram_notifications')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              attempts: notification.attempts + 1,
            })
            .eq('id', notification.id);

          results.push({ id: notification.id, success: true });
        } else {
          // Mark as failed
          await supabase
            .from('pending_telegram_notifications')
            .update({
              status: notification.attempts >= 2 ? 'failed' : 'pending',
              error_message: sendResult.description,
              attempts: notification.attempts + 1,
            })
            .eq('id', notification.id);

          results.push({ id: notification.id, success: false, error: sendResult.description });
        }
      } catch (err) {
        console.error('Error processing notification:', notification.id, err);
        results.push({ id: notification.id, success: false, error: String(err) });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return new Response(JSON.stringify({ 
      success: true, 
      processed: results.length,
      sent: successCount,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Process pending error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
