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
}

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function kickUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  console.log(`Kicking user ${userId} from chat ${chatId}`);
  
  const result = await telegramRequest(botToken, 'banChatMember', {
    chat_id: chatId,
    user_id: userId,
  });
  
  if (!result.ok) {
    if (result.description?.includes('user is not a member') || 
        result.description?.includes('PARTICIPANT_NOT_EXISTS') ||
        result.description?.includes('USER_NOT_PARTICIPANT')) {
      console.log(`User ${userId} not in chat ${chatId}, marking as success`);
      return { success: true };
    }
    return { success: false, error: result.description };
  }
  
  // Immediately unban so they can rejoin later if they pay again
  await telegramRequest(botToken, 'unbanChatMember', {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
  
  return { success: true };
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  return telegramRequest(botToken, 'sendMessage', body);
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://fsby.lovable.app';
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
    const { user_id, telegram_user_id, club_id, reason, is_manual } = body;

    console.log('Revoke access request:', { user_id, telegram_user_id, club_id, reason, is_manual });

    if (!user_id && !telegram_user_id) {
      return new Response(JSON.stringify({ error: 'user_id or telegram_user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!club_id) {
      return new Response(JSON.stringify({ error: 'club_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the club with bot info
    const { data: club, error: clubError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('id', club_id)
      .single();

    if (clubError || !club) {
      console.error('Club not found:', clubError);
      return new Response(JSON.stringify({ error: 'Club not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bot = club.telegram_bots;
    if (!bot || bot.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Bot inactive' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine telegram_user_id to kick
    let telegramUserId: number | null = telegram_user_id || null;
    let profileUserId: string | null = user_id || null;

    // If we have user_id, get telegram_user_id from profile
    if (user_id && !telegramUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id')
        .eq('user_id', user_id)
        .single();

      if (profile?.telegram_user_id) {
        telegramUserId = Number(profile.telegram_user_id);
      }
    }

    // If we have telegram_user_id but not user_id, try to find the profile
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
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = bot.bot_token_encrypted;
    let chatRevoked = false;
    let channelRevoked = false;

    console.log('Club info:', { 
      club_id: club.id, 
      chat_id: club.chat_id, 
      channel_id: club.channel_id,
      telegramUserId 
    });

    // Kick from chat
    if (club.chat_id) {
      console.log(`Kicking from chat ${club.chat_id}...`);
      const kickResult = await kickUser(botToken, club.chat_id, telegramUserId);
      chatRevoked = kickResult.success;
      console.log(`Chat kick result:`, kickResult);
      if (!kickResult.success) {
        console.error(`Failed to kick from chat ${club.chat_id}:`, kickResult.error);
      }
    } else {
      console.log('No chat_id configured for club');
    }

    // Kick from channel
    if (club.channel_id) {
      console.log(`Kicking from channel ${club.channel_id}...`);
      const kickResult = await kickUser(botToken, club.channel_id, telegramUserId);
      channelRevoked = kickResult.success;
      console.log(`Channel kick result:`, kickResult);
      if (!kickResult.success) {
        console.error(`Failed to kick from channel ${club.channel_id}:`, kickResult.error);
      }
    } else {
      console.log('No channel_id configured for club');
    }

    // Update telegram_access record if exists
    if (profileUserId) {
      const { data: accessRecord } = await supabase
        .from('telegram_access')
        .select('id')
        .eq('user_id', profileUserId)
        .eq('club_id', club_id)
        .single();

      if (accessRecord) {
        await supabase
          .from('telegram_access')
          .update({
            state_chat: chatRevoked ? 'revoked' : undefined,
            state_channel: channelRevoked ? 'revoked' : undefined,
            last_sync_at: new Date().toISOString(),
          })
          .eq('id', accessRecord.id);
      }

      // Deactivate manual access if exists
      if (is_manual) {
        await supabase
          .from('telegram_manual_access')
          .update({ is_active: false })
          .eq('user_id', profileUserId)
          .eq('club_id', club_id);
      }

      // Update telegram_access_grants
      await supabase
        .from('telegram_access_grants')
        .update({ 
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoke_reason: reason || 'manual_revoke',
        })
        .eq('user_id', profileUserId)
        .eq('club_id', club_id)
        .eq('status', 'active');
    }

    // Update telegram_club_members
    await supabase
      .from('telegram_club_members')
      .update({
        in_chat: chatRevoked ? false : undefined,
        in_channel: channelRevoked ? false : undefined,
        access_status: 'removed',
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', telegramUserId)
      .eq('club_id', club_id);

    // Notify user via bot
    const keyboard = {
      inline_keyboard: [
        [{ text: '💳 Продлить подписку', url: `${getSiteUrl()}/pricing` }],
      ],
    };

    await sendMessage(
      botToken,
      telegramUserId,
      `❌ Доступ отозван\n\nДоступ к чату и каналу был закрыт.\n\nТы можешь вернуться, оформив подписку 👇`,
      keyboard
    );

    // Log the action
    await supabase.from('telegram_logs').insert({
      user_id: profileUserId,
      club_id: club_id,
      action: is_manual ? 'MANUAL_REVOKE' : 'AUTO_REVOKE',
      target: 'both',
      status: (chatRevoked || channelRevoked) ? 'ok' : 'partial',
      meta: {
        telegram_user_id: telegramUserId,
        chat_revoked: chatRevoked,
        channel_revoked: channelRevoked,
        reason: reason || 'manual',
      },
    });

    console.log('Revoke completed:', { telegramUserId, chatRevoked, channelRevoked });

    return new Response(JSON.stringify({ 
      success: true, 
      chat_revoked: chatRevoked,
      channel_revoked: channelRevoked,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Revoke access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
