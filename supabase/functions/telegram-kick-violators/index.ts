import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telegram API request helper
async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// Check if user is actually in chat
async function checkMembership(botToken: string, chatId: number, userId: number): Promise<{
  isMember: boolean;
  status: string;
  error?: string;
}> {
  try {
    const result = await telegramRequest(botToken, 'getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });

    if (!result.ok) {
      if (result.description?.includes('user not found') || 
          result.description?.includes('USER_NOT_PARTICIPANT') ||
          result.description?.includes('CHAT_ADMIN_REQUIRED')) {
        return { isMember: false, status: 'not_found' };
      }
      return { isMember: false, status: 'error', error: result.description };
    }

    const memberStatus = result.result?.status;
    const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(memberStatus);
    
    return { isMember, status: memberStatus };
  } catch (error) {
    return { isMember: false, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Kick user from chat
async function kickUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    // First ban, then immediately unban (this kicks without permanent ban)
    const banResult = await telegramRequest(botToken, 'banChatMember', {
      chat_id: chatId,
      user_id: userId,
      revoke_messages: false,
    });
    
    if (!banResult.ok) {
      return { success: false, error: banResult.description || 'Failed to ban user' };
    }

    // Immediately unban so they can rejoin with valid invite
    await telegramRequest(botToken, 'unbanChatMember', {
      chat_id: chatId,
      user_id: userId,
      only_if_banned: true,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Log audit event
async function logAudit(supabase: any, event: {
  club_id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string;
  user_id?: string;
  telegram_user_id?: number;
  reason?: string;
  meta?: Record<string, unknown>;
}) {
  await supabase.from('telegram_access_audit').insert({
    club_id: event.club_id,
    event_type: event.event_type,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    user_id: event.user_id,
    telegram_user_id: event.telegram_user_id,
    reason: event.reason,
    meta: event.meta,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('=== Telegram Kick Violators Cron Started ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find all active clubs with autokick enabled
    const { data: clubs, error: clubsError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('is_active', true)
      .eq('autokick_no_access', true);

    if (clubsError) {
      console.error('Failed to fetch clubs:', clubsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch clubs' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${clubs?.length || 0} clubs with autokick enabled`);

    const results: {
      club_id: string;
      club_name: string;
      checked: number;
      kicked: number;
      errors: number;
    }[] = [];

    for (const club of clubs || []) {
      const botToken = club.telegram_bots?.bot_token_encrypted;
      if (!botToken) {
        console.log(`Club ${club.club_name}: No bot token, skipping`);
        continue;
      }

      console.log(`Processing club: ${club.club_name}`);

      // Find violators: access_status !== 'ok' AND (in_chat = true OR in_channel = true)
      const { data: violators, error: violatorsError } = await supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club.id)
        .neq('access_status', 'ok')
        .or('in_chat.eq.true,in_channel.eq.true');

      if (violatorsError) {
        console.error(`Failed to fetch violators for club ${club.club_name}:`, violatorsError);
        continue;
      }

      console.log(`Found ${violators?.length || 0} potential violators in ${club.club_name}`);

      let kickedCount = 0;
      let errorCount = 0;
      let checkedCount = 0;

      for (const member of violators || []) {
        checkedCount++;
        let kickedFromChat = false;
        let kickedFromChannel = false;

        // Verify and kick from chat if present
        if (club.chat_id && member.in_chat) {
          // Double-check membership before kicking
          const chatCheck = await checkMembership(botToken, club.chat_id, member.telegram_user_id);
          
          if (chatCheck.isMember) {
            console.log(`Kicking violator ${member.telegram_user_id} from chat ${club.chat_id}`);
            const kickResult = await kickUser(botToken, club.chat_id, member.telegram_user_id);
            
            if (kickResult.success) {
              kickedFromChat = true;
            } else {
              console.error(`Failed to kick from chat:`, kickResult.error);
              errorCount++;
            }
          } else {
            // Update record - not actually in chat
            await supabase
              .from('telegram_club_members')
              .update({ in_chat: false, updated_at: new Date().toISOString() })
              .eq('id', member.id);
          }
        }

        // Verify and kick from channel if present
        if (club.channel_id && member.in_channel) {
          const channelCheck = await checkMembership(botToken, club.channel_id, member.telegram_user_id);
          
          if (channelCheck.isMember) {
            console.log(`Kicking violator ${member.telegram_user_id} from channel ${club.channel_id}`);
            const kickResult = await kickUser(botToken, club.channel_id, member.telegram_user_id);
            
            if (kickResult.success) {
              kickedFromChannel = true;
            } else {
              console.error(`Failed to kick from channel:`, kickResult.error);
              errorCount++;
            }
          } else {
            // Update record - not actually in channel
            await supabase
              .from('telegram_club_members')
              .update({ in_channel: false, updated_at: new Date().toISOString() })
              .eq('id', member.id);
          }
        }

        // Update member record if kicked
        if (kickedFromChat || kickedFromChannel) {
          kickedCount++;
          
          await supabase
            .from('telegram_club_members')
            .update({
              in_chat: kickedFromChat ? false : member.in_chat,
              in_channel: kickedFromChannel ? false : member.in_channel,
              access_status: 'removed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', member.id);

          // Log audit event
          await logAudit(supabase, {
            club_id: club.id,
            event_type: 'CRON_KICK_VIOLATOR',
            actor_type: 'cron',
            telegram_user_id: member.telegram_user_id,
            user_id: member.profile_id,
            reason: 'Автоматическое удаление нарушителя (нет доступа)',
            meta: {
              kicked_from_chat: kickedFromChat,
              kicked_from_channel: kickedFromChannel,
              previous_access_status: member.access_status,
            },
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Log to telegram_logs
      if (kickedCount > 0 || checkedCount > 0) {
        await supabase.from('telegram_logs').insert({
          action: 'cron_kick_violators',
          club_id: club.id,
          status: errorCount > 0 ? 'partial' : 'success',
          meta: {
            checked: checkedCount,
            kicked: kickedCount,
            errors: errorCount,
          },
        });
      }

      results.push({
        club_id: club.id,
        club_name: club.club_name,
        checked: checkedCount,
        kicked: kickedCount,
        errors: errorCount,
      });

      console.log(`Club ${club.club_name}: checked=${checkedCount}, kicked=${kickedCount}, errors=${errorCount}`);
    }

    const totalKicked = results.reduce((sum, r) => sum + r.kicked, 0);
    const totalChecked = results.reduce((sum, r) => sum + r.checked, 0);

    console.log(`=== Cron completed: ${totalChecked} checked, ${totalKicked} kicked ===`);

    return new Response(JSON.stringify({
      success: true,
      total_checked: totalChecked,
      total_kicked: totalKicked,
      clubs: results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Cron error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
