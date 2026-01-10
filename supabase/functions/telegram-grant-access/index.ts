import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GrantAccessRequest {
  user_id: string;
  club_id?: string;
  is_manual?: boolean;
  admin_id?: string;
  valid_until?: string;
  comment?: string;
  source?: string;
  source_id?: string;
}

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  console.log(`Telegram API: ${method}`, params);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function unbanUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  const result = await telegramRequest(botToken, 'unbanChatMember', {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
  return { success: true };
}

// Create invite link with join request mode if enabled
async function createInviteLink(
  botToken: string, 
  chatId: number, 
  name: string,
  joinRequestMode: boolean
): Promise<{ link?: string; error?: string }> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    name: name || 'Auto-generated invite',
  };

  // CRITICAL: If join_request_mode is enabled, create links that require approval
  if (joinRequestMode) {
    params.creates_join_request = true;
    delete params.member_limit; // Can't use member_limit with creates_join_request
  }

  const result = await telegramRequest(botToken, 'createChatInviteLink', params);

  if (result.ok) {
    return { link: result.result.invite_link };
  }
  console.error('Failed to create invite link:', result);
  return { error: result.description || 'Failed to create invite link' };
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendMessage', body);
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
}

// Log audit
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

    const body: GrantAccessRequest = await req.json();
    const { user_id, club_id, is_manual, admin_id, valid_until, comment, source, source_id } = body;

    console.log('Grant access request:', body);

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!profile.telegram_user_id) {
      // Queue notification for when user links telegram
      console.log('Telegram not linked, queueing notification');
      
      // Get club info for context
      let targetClubId = club_id;
      if (!targetClubId) {
        const { data: defaultClub } = await supabase
          .from('telegram_clubs')
          .select('id')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        targetClubId = defaultClub?.id;
      }

      // Queue access granted notification
      await supabase.from('pending_telegram_notifications').insert({
        user_id,
        notification_type: 'access_granted',
        club_id: targetClubId,
        payload: {
          pending_access: true,
          source: source || (is_manual ? 'manual' : 'system'),
          comment,
          valid_until,
        },
        priority: 10, // High priority for access notifications
      });

      // Mark telegram_access as pending
      if (targetClubId) {
        await supabase.from('telegram_access').upsert({
          user_id,
          club_id: targetClubId,
          state_chat: 'pending',
          state_channel: 'pending',
          invites_pending: true,
          active_until: valid_until || null,
        }, { onConflict: 'user_id,club_id' });
      }

      await supabase.from('telegram_logs').insert({
        user_id, action: 'GRANT_QUEUED', status: 'ok', 
        error_message: 'Telegram not linked - notification queued',
        club_id: targetClubId,
      });

      return new Response(JSON.stringify({ 
        success: true, 
        queued: true,
        message: 'Notification queued - will be sent when user links Telegram',
        code: 'TG_NOT_LINKED_QUEUED' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get clubs
    let clubsQuery = supabase.from('telegram_clubs').select('*, telegram_bots(*)').eq('is_active', true);
    if (club_id) clubsQuery = clubsQuery.eq('id', club_id);
    const { data: clubs, error: clubsError } = await clubsQuery;

    if (clubsError || !clubs?.length) {
      return new Response(JSON.stringify({ error: 'No active clubs found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    const telegramUserId = Number(profile.telegram_user_id);

    for (const club of clubs) {
      const bot = club.telegram_bots;
      if (!bot || bot.status !== 'active') {
        results.push({ club_id: club.id, error: 'Bot inactive' });
        continue;
      }

      const botToken = bot.bot_token_encrypted;
      const joinRequestMode = club.join_request_mode ?? false;

      let chatInviteLink: string | null = null;
      let channelInviteLink: string | null = null;
      let chatUnbanned = false;
      let channelUnbanned = false;

      // Process chat
      if (club.chat_id) {
        await unbanUser(botToken, club.chat_id, telegramUserId);
        chatUnbanned = true;

        const inviteResult = await createInviteLink(
          botToken, 
          club.chat_id, 
          `Chat access for ${profile.email || user_id}`,
          joinRequestMode
        );
        chatInviteLink = inviteResult.link || club.chat_invite_link || null;
      }

      // Process channel
      if (club.channel_id) {
        await unbanUser(botToken, club.channel_id, telegramUserId);
        channelUnbanned = true;

        const inviteResult = await createInviteLink(
          botToken, 
          club.channel_id, 
          `Channel access for ${profile.email || user_id}`,
          joinRequestMode
        );
        channelInviteLink = inviteResult.link || club.channel_invite_link || null;
      }

      // Calculate active_until
      let activeUntil: string | null = valid_until || null;
      if (!activeUntil && !is_manual) {
        // First try subscriptions_v2
        const { data: subV2 } = await supabase
          .from('subscriptions_v2')
          .select('access_end_at')
          .eq('user_id', user_id)
          .in('status', ['active', 'trial'])
          .order('access_end_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (subV2?.access_end_at) {
          activeUntil = subV2.access_end_at;
        } else {
          // Fallback to legacy subscriptions table
          const { data: subscription } = await supabase
            .from('subscriptions')
            .select('expires_at')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .single();
          activeUntil = subscription?.expires_at || null;
        }
      }

      // Update telegram_access
      await supabase.from('telegram_access').upsert({
        user_id,
        club_id: club.id,
        state_chat: 'pending',
        state_channel: 'pending',
        active_until: activeUntil,
        last_sync_at: new Date().toISOString(),
      }, { onConflict: 'user_id,club_id' });

      // Create access grant record
      await supabase.from('telegram_access_grants').insert({
        user_id,
        club_id: club.id,
        source: source || (is_manual ? 'manual' : 'system'),
        source_id: source_id || null,
        granted_by: admin_id || null,
        start_at: new Date().toISOString(),
        end_at: activeUntil,
        status: 'active',
        meta: { comment, chat_invite_sent: !!chatInviteLink, channel_invite_sent: !!channelInviteLink },
      });

      // Create manual access record if needed
      if (is_manual && admin_id) {
        await supabase.from('telegram_manual_access').upsert({
          user_id,
          club_id: club.id,
          is_active: true,
          valid_until: valid_until || null,
          comment: comment || null,
          created_by_admin_id: admin_id,
        }, { onConflict: 'user_id,club_id' });
      }

      // Update member record
      await supabase.from('telegram_club_members').update({
        access_status: 'ok',
        updated_at: new Date().toISOString(),
      }).eq('telegram_user_id', telegramUserId).eq('club_id', club.id);

      // Send invite links via bot
      let dmSent = false;
      let dmError: string | undefined;

      if (chatInviteLink || channelInviteLink) {
        const keyboard: { inline_keyboard: Array<Array<{ text: string; url: string }>> } = { inline_keyboard: [] };
        if (chatInviteLink) keyboard.inline_keyboard.push([{ text: '💬 Войти в чат клуба', url: chatInviteLink }]);
        if (channelInviteLink) keyboard.inline_keyboard.push([{ text: '📣 Войти в канал клуба', url: channelInviteLink }]);

        const validUntilText = activeUntil
          ? `\n📅 Доступ активен до: ${new Date(activeUntil).toLocaleDateString('ru-RU')}`
          : '';

        const joinRequestNote = joinRequestMode
          ? '\n\n⏳ <i>После перехода по ссылке твоя заявка будет автоматически одобрена.</i>'
          : '\n\n⚠️ <i>Ссылки одноразовые — переходи сейчас!</i>';

        const result = await sendMessage(
          botToken,
          telegramUserId,
          `✅ <b>Доступ открыт!</b>\n\nЯ подготовил для тебя ссылки для входа в клуб.${validUntilText}${joinRequestNote}`,
          keyboard
        );

        dmSent = result.ok;
        if (!result.ok) dmError = result.description;

        // Update can_dm status
        const canDm = !result.description?.includes('bot was blocked') && !result.description?.includes("can't initiate");
        await supabase.from('telegram_club_members').update({
          can_dm: canDm,
        }).eq('telegram_user_id', telegramUserId).eq('club_id', club.id);
      }

      // Log audit
      await logAudit(supabase, {
        club_id: club.id,
        user_id,
        telegram_user_id: telegramUserId,
        event_type: 'GRANT',
        actor_type: is_manual ? 'admin' : 'system',
        actor_id: admin_id,
        reason: comment,
        telegram_chat_result: { unbanned: chatUnbanned, invite_link: chatInviteLink },
        telegram_channel_result: { unbanned: channelUnbanned, invite_link: channelInviteLink },
        meta: { dm_sent: dmSent, dm_error: dmError, valid_until: activeUntil, join_request_mode: joinRequestMode },
      });

      // Legacy log
      await supabase.from('telegram_logs').insert({
        user_id,
        club_id: club.id,
        action: is_manual ? 'MANUAL_GRANT' : 'AUTO_GRANT',
        target: 'both',
        status: (chatInviteLink || channelInviteLink) ? 'ok' : 'partial',
        meta: { chat_invite_link: chatInviteLink, channel_invite_link: channelInviteLink, valid_until: activeUntil },
      });

      // Notify admins about new access grant
      try {
        const validUntilFormatted = activeUntil
          ? new Date(activeUntil).toLocaleDateString('ru-RU')
          : 'Бессрочно';
        
        const grantSource = source || (is_manual ? 'Вручную' : 'Автоматически');
        
        await supabase.functions.invoke('telegram-notify-admins', {
          body: {
            message: `✅ <b>Доступ выдан</b>\n\n` +
              `👤 ${profile.full_name || profile.email || user_id}\n` +
              `📦 ${club.club_name || 'Клуб'}\n` +
              `📅 До: ${validUntilFormatted}\n` +
              `🔧 Источник: ${grantSource}` +
              (comment ? `\n💬 Комментарий: ${comment}` : ''),
          },
        });
      } catch (notifyError) {
        console.error('Failed to notify admins about grant:', notifyError);
      }

      results.push({
        club_id: club.id,
        chat_invite_link: chatInviteLink,
        channel_invite_link: channelInviteLink,
        dm_sent: dmSent,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Grant access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
