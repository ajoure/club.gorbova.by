import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Check membership via getChatMember - THE source of truth
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
    // Statuses: creator, administrator, member, restricted, left, kicked
    const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(memberStatus);
    
    return { isMember, status: memberStatus };
  } catch (error) {
    return { isMember: false, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Ban user from chat/channel
async function banUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await telegramRequest(botToken, 'banChatMember', {
      chat_id: chatId,
      user_id: userId,
      until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
    });

    if (!result.ok) {
      return { success: false, error: result.description };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Calculate access status from database records
function hasActiveAccess(
  userId: string | undefined,
  accessMap: Map<string, any>,
  manualAccessMap: Map<string, any>,
  grantsMap: Map<string, any>,
): boolean {
  if (!userId) return false;
  const now = new Date();

  const access = accessMap.get(userId);
  if (access) {
    if (access.state_chat === 'revoked' || access.state_channel === 'revoked') {
      return false;
    }
    const activeUntil = access.active_until ? new Date(access.active_until) : null;
    if (!activeUntil || activeUntil > now) return true;
  }

  const manual = manualAccessMap.get(userId);
  if (manual && manual.is_active) {
    const validUntil = manual.valid_until ? new Date(manual.valid_until) : null;
    if (!validUntil || validUntil > now) return true;
  }

  const grant = grantsMap.get(userId);
  if (grant && grant.status === 'active') {
    const endAt = grant.end_at ? new Date(grant.end_at) : null;
    if (!endAt || endAt > now) return true;
  }

  return false;
}

// Log audit event
async function logAudit(supabase: any, event: any) {
  await supabase.from('telegram_access_audit').insert(event);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('Starting Telegram cron sync...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active clubs with auto_resync enabled
    const { data: clubs, error: clubsError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('is_active', true)
      .eq('auto_resync_enabled', true);

    if (clubsError) {
      console.error('Error fetching clubs:', clubsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch clubs' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${clubs?.length || 0} clubs with auto_resync enabled`);

    const results: any[] = [];
    const BATCH_SIZE = 25; // Process 25 members at a time to avoid rate limits

    for (const club of clubs || []) {
      const bot = club.telegram_bots;
      if (!bot || bot.status !== 'active') {
        console.log(`Skipping club ${club.id} - bot inactive`);
        continue;
      }

      const botToken = bot.bot_token_encrypted;
      const autokick = club.autokick_no_access ?? false;

      console.log(`Processing club: ${club.club_name} (autokick: ${autokick})`);

      // Get access records for this club
      const { data: accessRecords } = await supabase
        .from('telegram_access')
        .select('user_id, state_chat, state_channel, active_until')
        .eq('club_id', club.id);
      const accessMap = new Map(accessRecords?.map((a: any) => [a.user_id, a]) || []);

      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('user_id, is_active, valid_until')
        .eq('club_id', club.id);
      const manualAccessMap = new Map(manualAccess?.map((a: any) => [a.user_id, a]) || []);

      const { data: accessGrants } = await supabase
        .from('telegram_access_grants')
        .select('user_id, status, end_at')
        .eq('club_id', club.id);
      const grantsMap = new Map(accessGrants?.map((a: any) => [a.user_id, a]) || []);

      // Get members with linked profiles (have telegram_user_id)
      const { data: members } = await supabase
        .from('telegram_club_members')
        .select('*, profiles(*)')
        .eq('club_id', club.id)
        .not('profile_id', 'is', null);

      if (!members?.length) {
        console.log(`No linked members in club ${club.id}`);
        continue;
      }

      let checkedCount = 0;
      let kickedCount = 0;
      let errorCount = 0;

      // Process in batches
      for (let i = 0; i < members.length; i += BATCH_SIZE) {
        const batch = members.slice(i, i + BATCH_SIZE);

        for (const member of batch) {
          try {
            // Check chat membership (master source of truth)
            let chatResult: { isMember: boolean; status: string; error?: string } | null = null;
            
            if (club.chat_id) {
              chatResult = await checkMembership(botToken, club.chat_id, member.telegram_user_id);
              
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            const inChat = chatResult?.isMember ?? null;
            // Channel status is derived from chat (master)
            const inChannel = inChat;

            // Update member record
            await supabase.from('telegram_club_members').update({
              in_chat: inChat,
              in_channel: inChannel, // Derived from chat
              last_telegram_check_at: new Date().toISOString(),
              last_telegram_check_result: { chat: chatResult, channel: 'derived_from_chat' },
              updated_at: new Date().toISOString(),
            }).eq('id', member.id);

            checkedCount++;

            // Check if should kick (autokick enabled + in chat but no access)
            const userId = member.profiles?.user_id;
            const hasAccess = hasActiveAccess(userId, accessMap, manualAccessMap, grantsMap);

            if (autokick && inChat && !hasAccess) {
              console.log(`Autokicking user ${member.telegram_user_id} - no access but in chat`);

              let chatKickResult = null;
              let channelKickResult = null;

              if (club.chat_id) {
                chatKickResult = await banUser(botToken, club.chat_id, member.telegram_user_id);
              }
              if (club.channel_id) {
                channelKickResult = await banUser(botToken, club.channel_id, member.telegram_user_id);
              }

              // Update member status
              await supabase.from('telegram_club_members').update({
                in_chat: false,
                in_channel: false,
                access_status: 'removed',
                updated_at: new Date().toISOString(),
              }).eq('id', member.id);

              // Log audit
              await logAudit(supabase, {
                club_id: club.id,
                user_id: userId,
                telegram_user_id: member.telegram_user_id,
                event_type: 'AUTOKICK',
                actor_type: 'cron',
                reason: 'No active access - removed by cron',
                telegram_chat_result: chatKickResult,
                telegram_channel_result: channelKickResult,
              });

              kickedCount++;
            }
          } catch (error) {
            console.error(`Error processing member ${member.telegram_user_id}:`, error);
            errorCount++;
          }
        }

        // Delay between batches to avoid rate limits
        if (i + BATCH_SIZE < members.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Update club last sync time
      await supabase.from('telegram_clubs').update({
        last_status_check_at: new Date().toISOString(),
      }).eq('id', club.id);

      // Log sync event
      await logAudit(supabase, {
        club_id: club.id,
        event_type: 'CRON_SYNC',
        actor_type: 'cron',
        meta: { checked_count: checkedCount, kicked_count: kickedCount, error_count: errorCount },
      });

      results.push({
        club_id: club.id,
        club_name: club.club_name,
        checked: checkedCount,
        kicked: kickedCount,
        errors: errorCount,
      });

      console.log(`Club ${club.club_name}: checked ${checkedCount}, kicked ${kickedCount}, errors ${errorCount}`);
    }

    console.log('Cron sync completed');

    return new Response(JSON.stringify({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Cron sync error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
