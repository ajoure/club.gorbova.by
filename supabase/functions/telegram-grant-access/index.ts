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

// Telegram API helpers
async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  console.log(`Telegram API: ${method}`, params);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const result = await response.json();
  console.log(`Telegram API response:`, result);
  return result;
}

async function unbanUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  // Unban in case user was kicked before - this allows them to join via invite link
  const result = await telegramRequest(botToken, 'unbanChatMember', {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
  
  // This may fail if user was never banned, which is fine
  return { success: true };
}

async function createInviteLink(botToken: string, chatId: number, name?: string): Promise<{ link?: string; error?: string }> {
  const result = await telegramRequest(botToken, 'createChatInviteLink', {
    chat_id: chatId,
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    name: name || 'Auto-generated invite',
  });
  
  if (result.ok) {
    return { link: result.result.invite_link };
  }
  console.error('Failed to create invite link:', result);
  return { error: result.description || 'Failed to create invite link' };
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

    const body: GrantAccessRequest = await req.json();
    const { user_id, club_id, is_manual, admin_id, valid_until, comment, source, source_id } = body;

    console.log('Grant access request:', body);

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user profile with Telegram info
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!profile.telegram_user_id) {
      await supabase.from('telegram_logs').insert({
        user_id,
        action: 'GRANT_FAILED',
        status: 'error',
        error_message: 'Telegram not linked',
      });
      
      return new Response(JSON.stringify({ error: 'Telegram not linked', code: 'TG_NOT_LINKED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get clubs to grant access to
    let clubsQuery = supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('is_active', true);

    if (club_id) {
      clubsQuery = clubsQuery.eq('id', club_id);
    }

    const { data: clubs, error: clubsError } = await clubsQuery;

    if (clubsError || !clubs || clubs.length === 0) {
      return new Response(JSON.stringify({ error: 'No active clubs found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      
      let chatInviteLink: string | null = null;
      let channelInviteLink: string | null = null;
      let chatUnbanned = false;
      let channelUnbanned = false;

      // Process chat access
      if (club.chat_id) {
        // First unban the user (in case they were kicked before)
        const unbanResult = await unbanUser(botToken, club.chat_id, telegramUserId);
        chatUnbanned = unbanResult.success;
        
        // Create invite link (always - user needs to join manually via Telegram)
        const inviteResult = await createInviteLink(botToken, club.chat_id, `Chat access for ${profile.email || user_id}`);
        if (inviteResult.link) {
          chatInviteLink = inviteResult.link;
        } else {
          // Use existing invite link from club settings as fallback
          chatInviteLink = club.chat_invite_link || null;
        }
      }

      // Process channel access
      if (club.channel_id) {
        // First unban the user
        const unbanResult = await unbanUser(botToken, club.channel_id, telegramUserId);
        channelUnbanned = unbanResult.success;
        
        // Create invite link
        const inviteResult = await createInviteLink(botToken, club.channel_id, `Channel access for ${profile.email || user_id}`);
        if (inviteResult.link) {
          channelInviteLink = inviteResult.link;
        } else {
          // Use existing invite link from club settings as fallback
          channelInviteLink = club.channel_invite_link || null;
        }
      }

      // Calculate active_until
      let activeUntil: string | null = null;
      if (valid_until) {
        activeUntil = valid_until;
      } else if (!is_manual) {
        // Get from subscription
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('expires_at')
          .eq('user_id', user_id)
          .eq('is_active', true)
          .single();
        
        activeUntil = subscription?.expires_at || null;
      }

      // Update or create telegram_access record
      const { error: accessError } = await supabase
        .from('telegram_access')
        .upsert({
          user_id,
          club_id: club.id,
          state_chat: 'pending', // Will become 'active' when user joins
          state_channel: 'pending',
          active_until: activeUntil,
          last_sync_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,club_id',
        });

      if (accessError) {
        console.error('Failed to update telegram_access:', accessError);
      }

      // Create telegram_access_grants record for history
      await supabase
        .from('telegram_access_grants')
        .insert({
          user_id,
          club_id: club.id,
          source: source || (is_manual ? 'manual' : 'system'),
          source_id: source_id || null,
          granted_by: admin_id || null,
          start_at: new Date().toISOString(),
          end_at: activeUntil,
          status: 'active',
          meta: {
            comment: comment || null,
            chat_invite_sent: !!chatInviteLink,
            channel_invite_sent: !!channelInviteLink,
          },
        });

      // If manual access, create/update manual access record
      if (is_manual && admin_id) {
        await supabase
          .from('telegram_manual_access')
          .upsert({
            user_id,
            club_id: club.id,
            is_active: true,
            valid_until: valid_until || null,
            comment: comment || null,
            created_by_admin_id: admin_id,
          }, {
            onConflict: 'user_id,club_id',
          });
      }

      // Update telegram_club_members
      await supabase
        .from('telegram_club_members')
        .update({
          access_status: 'ok',
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_user_id', telegramUserId)
        .eq('club_id', club.id);

      // Send invite links to user via bot
      if (chatInviteLink || channelInviteLink) {
        const keyboard: { inline_keyboard: Array<Array<{ text: string; url: string }>> } = {
          inline_keyboard: [],
        };
        
        if (chatInviteLink) {
          keyboard.inline_keyboard.push([{ text: '💬 Войти в чат клуба', url: chatInviteLink }]);
        }
        if (channelInviteLink) {
          keyboard.inline_keyboard.push([{ text: '📣 Войти в канал клуба', url: channelInviteLink }]);
        }

        const validUntilText = activeUntil 
          ? `\n📅 Доступ активен до: ${new Date(activeUntil).toLocaleDateString('ru-RU')}`
          : '';

        await sendMessage(
          botToken, 
          telegramUserId,
          `✅ <b>Доступ открыт!</b>\n\nЯ подготовил для тебя ссылки для входа в клуб.${validUntilText}\n\n⚠️ <i>Ссылки одноразовые — переходи сейчас!</i>`,
          keyboard
        );

        console.log('Invite links sent to user:', telegramUserId);
      }

      // Log the action
      await supabase.from('telegram_logs').insert({
        user_id,
        club_id: club.id,
        action: is_manual ? 'MANUAL_GRANT' : 'AUTO_GRANT',
        target: 'both',
        status: (chatInviteLink || channelInviteLink) ? 'ok' : 'partial',
        meta: {
          chat_unbanned: chatUnbanned,
          channel_unbanned: channelUnbanned,
          chat_invite_link: chatInviteLink,
          channel_invite_link: channelInviteLink,
          valid_until: activeUntil,
          comment: comment,
        },
      });

      results.push({
        club_id: club.id,
        chat_invite_link: chatInviteLink,
        channel_invite_link: channelInviteLink,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Grant access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
