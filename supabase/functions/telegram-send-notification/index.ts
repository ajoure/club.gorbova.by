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

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user profile with telegram_user_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_username, full_name')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile?.telegram_user_id) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'User has no Telegram linked' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get subscription info
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    // Get telegram access - check ALL access records, not just active ones
    // This is needed for access_revoked notifications when access is already revoked
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
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No active Telegram bot configured' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare message based on type
    let message = '';
    // Use SITE_URL env var or construct from product landing page with pricing anchor
    const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
    const pricingUrl = `${siteUrl}/#pricing`;
    
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

    // Log the notification
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
        }
      });

    // Audit log
    await supabase
      .from('audit_logs')
      .insert({
        action: 'telegram_notification_sent',
        actor_user_id: user.id,
        target_user_id: user_id,
        meta: {
          message_type,
          telegram_user_id: profile.telegram_user_id,
          success: sendResult.ok,
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
