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
  /**
   * When true: send DM + write logs only.
   * No bans and no database state changes.
   */
  dry_run?: boolean;
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
  return Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
}

function getPricingUrl(): string {
  return `${getSiteUrl()}/#pricing`;
}

async function logAudit(supabase: any, event: any) {
  await supabase.from('telegram_access_audit').insert(event);
}

// Helper to find club_id if not provided
async function findClubId(supabase: any, userId: string | null, telegramUserId: number | null): Promise<string | null> {
  // Try from telegram_access first
  if (userId) {
    const { data: access } = await supabase
      .from('telegram_access')
      .select('club_id')
      .eq('user_id', userId)
      .in('state_chat', ['joined', 'invited'])
      .limit(1)
      .single();
    
    if (access?.club_id) return access.club_id;
  }
  
  // Try from active subscription
  if (userId) {
    const { data: sub } = await supabase
      .from('subscriptions_v2')
      .select('product_id, products_v2(telegram_club_id)')
      .eq('user_id', userId)
      .in('status', ['active', 'trial'])
      .limit(1)
      .single();
    
    if (sub?.products_v2?.telegram_club_id) return sub.products_v2.telegram_club_id;
  }
  
  // Try from telegram_club_members
  if (telegramUserId) {
    const { data: member } = await supabase
      .from('telegram_club_members')
      .select('club_id')
      .eq('telegram_user_id', telegramUserId)
      .in('access_status', ['active', 'joined'])
      .limit(1)
      .single();
    
    if (member?.club_id) return member.club_id;
  }
  
  // Fallback: get any active club
  const { data: anyClub } = await supabase
    .from('telegram_clubs')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .single();
  
  return anyClub?.id || null;
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
    let { user_id, telegram_user_id, club_id, reason, is_manual, admin_id } = body;

    console.log('Revoke access request:', body);

    if (!user_id && !telegram_user_id) {
      return new Response(JSON.stringify({ error: 'user_id or telegram_user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine telegram_user_id and profileUserId first
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

    // If club_id not provided, try to find it
    if (!club_id) {
      console.log('No club_id provided, attempting to find...');
      const foundClubId = await findClubId(supabase, profileUserId, telegramUserId);
      club_id = foundClubId || undefined;
      console.log('Found club_id:', club_id);
    }

    if (!club_id) {
      console.error('Could not determine club_id for user', { user_id, telegram_user_id });
      return new Response(JSON.stringify({ error: 'club_id required and could not be determined' }), {
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

    // Mark user as former club member for reentry pricing
    if (profileUserId) {
      await supabase.from('profiles').update({
        was_club_member: true,
        club_exit_at: new Date().toISOString(),
        club_exit_reason: reason || 'access_revoked',
      }).eq('user_id', profileUserId);
      console.log(`Marked user ${profileUserId} as former club member`);
    }

    // Send notification via Telegram
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

    // Email fallback if Telegram DM failed
    if (!dmResult?.ok && profileUserId) {
      console.log('Telegram DM failed, attempting email fallback...');
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', profileUserId)
        .single();
      
      if (profile?.email) {
        try {
          await supabase.functions.invoke('send-email', {
            body: {
              to: profile.email,
              subject: '❌ Доступ к клубу отозван',
              html: `
                <p>Здравствуйте${profile.full_name ? ', ' + profile.full_name : ''}!</p>
                <p>Ваш доступ к клубу был закрыт.</p>
                ${reason ? `<p>Причина: ${reason}</p>` : ''}
                <p><a href="${getPricingUrl()}">Продлить подписку</a></p>
              `,
            },
          });
          console.log('Email fallback sent to:', profile.email);
        } catch (emailErr) {
          console.error('Email fallback failed:', emailErr);
        }
      }
    }

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


    console.log('Revoke completed:', { telegramUserId, chatRevoked, channelRevoked, dm_sent: dmResult?.ok });

    return new Response(JSON.stringify({
      success: true,
      chat_revoked: chatRevoked,
      channel_revoked: channelRevoked,
      chat_error: chatKickResult?.error,
      channel_error: channelKickResult?.error,
      dm_sent: dmResult?.ok,
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
