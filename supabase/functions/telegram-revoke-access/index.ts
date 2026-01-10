import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RevokeAccessRequest {
  user_id?: string;
  telegram_user_id?: number;
  club_id?: string;
  reason?: string;
  is_manual?: boolean;
  admin_id?: string;
}

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// CRITICAL: Ban user permanently (no automatic unban) to prevent rejoin via old links
async function banUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string; notMember?: boolean }> {
  console.log(`Banning user ${userId} from chat ${chatId} (permanent, no unban)`);
  
  const result = await telegramRequest(botToken, 'banChatMember', {
    chat_id: chatId,
    user_id: userId,
    // Ban for 366 days to prevent rejoin - user can be unbanned manually when access is restored
    until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
  });
  
  console.log(`banChatMember result for ${chatId}:`, result);
  
  if (!result.ok) {
    if (result.description?.includes('user is not a member') || 
        result.description?.includes('PARTICIPANT_NOT_EXISTS') ||
        result.description?.includes('USER_NOT_PARTICIPANT')) {
      // User not in chat - still try to ban to prevent future joins
      console.log(`User ${userId} not in chat ${chatId}, attempting preventive ban`);
      const preventiveBan = await telegramRequest(botToken, 'banChatMember', {
        chat_id: chatId,
        user_id: userId,
        until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
      });
      return { success: preventiveBan.ok || true, notMember: true };
    }
    if (result.description?.includes('not enough rights')) {
      return { success: false, error: result.description };
    }
    return { success: false, error: result.description };
  }
  
  // DO NOT UNBAN - this prevents rejoin via old invite links
  // User will be unbanned when access is granted again via telegram-grant-access
  
  return { success: true };
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendMessage', body);
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://gorbova.club';
}

function getPricingUrl(): string {
  return `${getSiteUrl()}/club#pricing`;
}

async function logAudit(supabase: any, event: any) {
  await supabase.from('telegram_access_audit').insert(event);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RevokeAccessRequest = await req.json();
    const { user_id, telegram_user_id, club_id, reason, is_manual, admin_id } = body;

    console.log('Revoke access request:', body);

    if (!user_id && !telegram_user_id) {
      return new Response(JSON.stringify({ error: 'user_id or telegram_user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!club_id) {
      return new Response(JSON.stringify({ error: 'club_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get club with bot
    const { data: club, error: clubError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('id', club_id)
      .single();

    if (clubError || !club) {
      return new Response(JSON.stringify({ error: 'Club not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bot = club.telegram_bots;
    if (!bot || bot.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Bot inactive' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine telegram_user_id
    let telegramUserId: number | null = telegram_user_id || null;
    let profileUserId: string | null = user_id || null;

    if (user_id && !telegramUserId) {
      // Try finding by profiles.user_id first
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, id, user_id')
        .eq('user_id', user_id)
        .single();
      if (profile?.telegram_user_id) {
        telegramUserId = Number(profile.telegram_user_id);
        profileUserId = profile.user_id || user_id;
      } else {
        // Fallback: try finding by profiles.id (some systems use profile id as user_id)
        const { data: profileById } = await supabase
          .from('profiles')
          .select('telegram_user_id, id, user_id')
          .eq('id', user_id)
          .single();
        if (profileById?.telegram_user_id) {
          telegramUserId = Number(profileById.telegram_user_id);
          profileUserId = profileById.user_id || user_id;
        }
      }
    }

    if (telegramUserId && !profileUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('telegram_user_id', telegramUserId)
        .single();
      if (profile?.user_id) {
        profileUserId = profile.user_id;
      }
    }

    if (!telegramUserId) {
      return new Response(JSON.stringify({ error: 'Could not determine telegram_user_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = bot.bot_token_encrypted;
    let chatKickResult: { success: boolean; error?: string; notMember?: boolean } | null = null;
    let channelKickResult: { success: boolean; error?: string; notMember?: boolean } | null = null;

    // Ban from chat (permanent until access is restored)
    if (club.chat_id) {
      console.log(`Banning from chat ${club.chat_id}...`);
      chatKickResult = await banUser(botToken, club.chat_id, telegramUserId);
      console.log('Chat ban result:', chatKickResult);
    }

    // Ban from channel (permanent until access is restored)
    if (club.channel_id) {
      console.log(`Banning from channel ${club.channel_id}...`);
      channelKickResult = await banUser(botToken, club.channel_id, telegramUserId);
      console.log('Channel ban result:', channelKickResult);
    }

    const chatRevoked = chatKickResult?.success ?? false;
    const channelRevoked = channelKickResult?.success ?? false;

    // Update telegram_access
    if (profileUserId) {
      await supabase.from('telegram_access').update({
        state_chat: 'revoked',
        state_channel: 'revoked',
        last_sync_at: new Date().toISOString(),
      }).eq('user_id', profileUserId).eq('club_id', club_id);

      // Deactivate manual access
      if (is_manual) {
        await supabase.from('telegram_manual_access').update({
          is_active: false,
        }).eq('user_id', profileUserId).eq('club_id', club_id);
      }

      // Update access grants
      await supabase.from('telegram_access_grants').update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: admin_id || null,
        revoke_reason: reason || 'manual_revoke',
      }).eq('user_id', profileUserId).eq('club_id', club_id).eq('status', 'active');
    }

    // Update member record
    await supabase.from('telegram_club_members').update({
      in_chat: chatRevoked ? false : undefined,
      in_channel: channelRevoked ? false : undefined,
      access_status: 'removed',
      updated_at: new Date().toISOString(),
    }).eq('telegram_user_id', telegramUserId).eq('club_id', club_id);

    // Send notification
    let dmResult: any = null;
    const keyboard = {
      inline_keyboard: [[{ text: '💳 Продлить подписку', url: getPricingUrl() }]],
    };
    dmResult = await sendMessage(
      botToken,
      telegramUserId,
      `❌ Доступ отозван\n\nДоступ к чату и каналу был закрыт.\n\nТы можешь вернуться, оформив подписку 👇`,
      keyboard
    );

    // Log audit
    await logAudit(supabase, {
      club_id,
      user_id: profileUserId,
      telegram_user_id: telegramUserId,
      event_type: 'REVOKE',
      actor_type: is_manual ? 'admin' : 'system',
      actor_id: admin_id,
      reason,
      telegram_chat_result: chatKickResult,
      telegram_channel_result: channelKickResult,
      meta: { dm_sent: dmResult?.ok, dm_error: dmResult?.description },
    });

    // Legacy log
    await supabase.from('telegram_logs').insert({
      user_id: profileUserId,
      club_id,
      action: is_manual ? 'MANUAL_REVOKE' : 'AUTO_REVOKE',
      target: 'both',
      status: (chatRevoked || channelRevoked) ? 'ok' : 'partial',
      meta: { telegram_user_id: telegramUserId, chat_revoked: chatRevoked, channel_revoked: channelRevoked, reason },
    });

    // --- Notify super admins about access revocation ---
    try {
      // Get user profile for notification
      let userInfo = { full_name: 'Неизвестно', email: 'Не указан', phone: 'Не указан', telegram_username: null as string | null };
      if (profileUserId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, phone, telegram_username')
          .eq('user_id', profileUserId)
          .single();
        if (profile) {
          userInfo = {
            full_name: profile.full_name || 'Не указано',
            email: profile.email || 'Не указан',
            phone: profile.phone || 'Не указан',
            telegram_username: profile.telegram_username,
          };
        }
      }

      const revokeMessage = `🚫 Доступ отозван\n\n` +
        `👤 <b>Клиент:</b> ${userInfo.full_name}\n` +
        `📧 Email: ${userInfo.email}\n` +
        `📱 Телефон: ${userInfo.phone}\n` +
        (userInfo.telegram_username ? `💬 Telegram: @${userInfo.telegram_username}\n` : '') +
        `\n📍 <b>Клуб:</b> ${club.name || club_id}\n` +
        `📝 Причина: ${reason || (is_manual ? 'Ручное отключение' : 'Истёк срок подписки')}\n` +
        `⚙️ Тип: ${is_manual ? 'Ручное' : 'Автоматическое'}`;

      await supabase.functions.invoke('telegram-notify-admins', {
        body: { message: revokeMessage },
      });
      console.log('Super admins notified about access revocation');
    } catch (notifyError) {
      console.error('Error notifying super admins about revocation:', notifyError);
      // Don't fail if notification fails
    }

    console.log('Revoke completed:', { telegramUserId, chatRevoked, channelRevoked });

    return new Response(JSON.stringify({
      success: true,
      chat_revoked: chatRevoked,
      channel_revoked: channelRevoked,
      chat_error: chatKickResult?.error,
      channel_error: channelKickResult?.error,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Revoke access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
