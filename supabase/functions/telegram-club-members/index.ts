import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClubMember {
  telegram_user_id: number;
  telegram_username?: string;
  telegram_first_name?: string;
  telegram_last_name?: string;
  profile_id?: string;
  user_id?: string;
  in_chat: boolean;
  in_channel: boolean;
}

// ==========================================
// Telegram API Helpers
// ==========================================

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// THE ONLY CORRECT WAY TO CHECK MEMBERSHIP - via getChatMember
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
      // User not found or other error
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

async function getChatMemberCount(botToken: string, chatId: number): Promise<{ count?: number; error?: string }> {
  try {
    const result = await telegramRequest(botToken, 'getChatMemberCount', { chat_id: chatId });
    if (!result.ok) {
      return { error: result.description || 'Failed to get member count' };
    }
    return { count: result.result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function getChatAdministrators(
  botToken: string,
  chatId: number,
): Promise<{ admins: { telegram_user_id: number; telegram_username?: string; telegram_first_name?: string; telegram_last_name?: string }[]; error?: string }> {
  try {
    const result = await telegramRequest(botToken, 'getChatAdministrators', { chat_id: chatId });
    const admins: { telegram_user_id: number; telegram_username?: string; telegram_first_name?: string; telegram_last_name?: string }[] = [];
    if (result.ok && result.result) {
      for (const admin of result.result) {
        if (!admin.user.is_bot) {
          admins.push({
            telegram_user_id: admin.user.id,
            telegram_username: admin.user.username,
            telegram_first_name: admin.user.first_name,
            telegram_last_name: admin.user.last_name,
          });
        }
      }
    }
    return { admins };
  } catch (error) {
    return { admins: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function kickMember(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string; notMember?: boolean }> {
  try {
    const banResult = await telegramRequest(botToken, 'banChatMember', {
      chat_id: chatId,
      user_id: userId,
      revoke_messages: false,
    });

    if (!banResult.ok) {
      if (banResult.description?.includes('user is not a member') ||
          banResult.description?.includes('PARTICIPANT_NOT_EXISTS') ||
          banResult.description?.includes('USER_NOT_PARTICIPANT')) {
        return { success: true, notMember: true };
      }
      if (banResult.description?.includes('not enough rights')) {
        return { success: false, error: banResult.description };
      }
      return { success: false, error: banResult.description };
    }

    // Immediately unban to allow rejoin with proper invite
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

// Calculate access status
function calculateAccessStatus(
  userId: string | undefined,
  accessRecords: Map<string, any>,
  manualAccessMap: Map<string, any>,
  grantsMap: Map<string, any>,
): 'ok' | 'expired' | 'no_access' | 'removed' {
  if (!userId) return 'no_access';

  let hasExpiredAccess = false;
  const now = new Date();

  const access = accessRecords.get(userId);
  if (access) {
    if (access.state_chat === 'revoked' || access.state_channel === 'revoked') {
      return 'removed';
    }
    const activeUntil = access.active_until ? new Date(access.active_until) : null;
    if (!activeUntil || activeUntil > now) return 'ok';
    hasExpiredAccess = true;
  }

  const manual = manualAccessMap.get(userId);
  if (manual && manual.is_active) {
    const validUntil = manual.valid_until ? new Date(manual.valid_until) : null;
    if (!validUntil || validUntil > now) return 'ok';
    hasExpiredAccess = true;
  }

  const grant = grantsMap.get(userId);
  if (grant && grant.status === 'active') {
    const endAt = grant.end_at ? new Date(grant.end_at) : null;
    if (!endAt || endAt > now) return 'ok';
    hasExpiredAccess = true;
  }

  return hasExpiredAccess ? 'expired' : 'no_access';
}

// Log audit event
async function logAudit(
  supabase: any,
  event: {
    club_id: string;
    user_id?: string;
    telegram_user_id?: number;
    event_type: string;
    actor_type?: string;
    actor_id?: string;
    reason?: string;
    telegram_chat_result?: any;
    telegram_channel_result?: any;
    meta?: any;
  }
) {
  await supabase.from('telegram_access_audit').insert({
    club_id: event.club_id,
    user_id: event.user_id,
    telegram_user_id: event.telegram_user_id,
    event_type: event.event_type,
    actor_type: event.actor_type || 'system',
    actor_id: event.actor_id,
    reason: event.reason,
    telegram_chat_result: event.telegram_chat_result,
    telegram_channel_result: event.telegram_channel_result,
    meta: event.meta,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const isServiceInvocation = authHeader === `Bearer ${supabaseServiceKey}`;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let requesterLabel = 'internal';
    let requesterId: string | undefined;

    if (!isServiceInvocation) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authorization required' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: hasPermission } = await userClient.rpc('has_permission', {
        _user_id: user.id, _permission_code: 'telegram.clubs.manage',
      });
      const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
      const { data: isSuperAdmin } = await userClient.rpc('is_super_admin', { _user_id: user.id });

      const isAdmin = !!hasPermission || !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      requesterLabel = user.email ?? user.id;
      requesterId = user.id;
    }

    const body = await req.json();
    const { action, club_id, member_ids, profile_id, telegram_user_id } = body;
    console.log(`Club members action: ${action}, club_id: ${club_id}, requester: ${requesterLabel}`);

    // Get club with bot
    const { data: club, error: clubError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('id', club_id)
      .single();

    if (clubError || !club) {
      return new Response(JSON.stringify({ success: false, error: 'Club not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = club.telegram_bots?.bot_token_encrypted;
    if (!botToken) {
      return new Response(JSON.stringify({ success: false, error: 'Bot token not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: CHECK_STATUS - Check actual Telegram membership via getChatMember
    // ==========================================
    if (action === 'check_status') {
      const targetMembers = member_ids?.length > 0
        ? await supabase.from('telegram_club_members').select('*').eq('club_id', club_id).in('id', member_ids)
        : await supabase.from('telegram_club_members').select('*').eq('club_id', club_id).limit(50);

      const members = targetMembers.data || [];
      const results: any[] = [];
      let checkedCount = 0;

      for (const member of members) {
        let chatResult: { isMember: boolean; status: string; error?: string } | null = null;
        let channelResult: { isMember: boolean; status: string; error?: string } | null = null;

        if (club.chat_id) {
          chatResult = await checkMembership(botToken, club.chat_id, member.telegram_user_id);
        }
        if (club.channel_id) {
          channelResult = await checkMembership(botToken, club.channel_id, member.telegram_user_id);
        }

        const inChat = chatResult?.isMember ?? null;
        const inChannel = channelResult?.isMember ?? null;

        // Update member record
        await supabase.from('telegram_club_members').update({
          in_chat: inChat,
          in_channel: inChannel,
          last_telegram_check_at: new Date().toISOString(),
          last_telegram_check_result: { chat: chatResult, channel: channelResult },
          updated_at: new Date().toISOString(),
        }).eq('id', member.id);

        checkedCount++;
        results.push({
          telegram_user_id: member.telegram_user_id,
          in_chat: inChat,
          in_channel: inChannel,
          chat_status: chatResult?.status,
          channel_status: channelResult?.status,
        });
      }

      // Update club last check time
      await supabase.from('telegram_clubs').update({
        last_status_check_at: new Date().toISOString(),
      }).eq('id', club_id);

      // Log audit
      await logAudit(supabase, {
        club_id,
        event_type: 'STATUS_CHECK',
        actor_type: 'admin',
        actor_id: requesterId,
        meta: { checked_count: checkedCount },
      });

      return new Response(JSON.stringify({
        success: true,
        checked_count: checkedCount,
        results,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // Action: SYNC - Synchronize members from DB
    // ==========================================
    if (action === 'sync') {
      console.log('Starting sync for club:', club_id);

      let chatTotal: number | undefined;
      let channelTotal: number | undefined;

      if (club.chat_id) {
        const countResult = await getChatMemberCount(botToken, club.chat_id);
        chatTotal = countResult.count;
      }
      if (club.channel_id) {
        const countResult = await getChatMemberCount(botToken, club.channel_id);
        channelTotal = countResult.count;
      }

      // Get all profiles with linked Telegram
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, user_id, telegram_user_id, telegram_username, full_name, telegram_linked_at')
        .not('telegram_user_id', 'is', null);

      // Get access records
      const { data: accessRecords } = await supabase
        .from('telegram_access')
        .select('user_id, state_chat, state_channel, active_until')
        .eq('club_id', club_id);
      const accessMap = new Map(accessRecords?.map(a => [a.user_id, a]) || []);

      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('user_id, is_active, valid_until')
        .eq('club_id', club_id);
      const manualAccessMap = new Map(manualAccess?.map(a => [a.user_id, a]) || []);

      const { data: accessGrants } = await supabase
        .from('telegram_access_grants')
        .select('user_id, status, end_at')
        .eq('club_id', club_id);
      const grantsMap = new Map(accessGrants?.map(a => [a.user_id, a]) || []);

      // Existing members
      const { data: existingMembers } = await supabase
        .from('telegram_club_members')
        .select('telegram_user_id, in_chat, in_channel, access_status, last_telegram_check_at')
        .eq('club_id', club_id);
      const existingMembersMap = new Map(existingMembers?.map(m => [m.telegram_user_id, m]) || []);

      const membersToUpsert: any[] = [];
      let countActive = 0, countExpired = 0, countNoAccess = 0, countRemoved = 0;

      for (const profile of allProfiles || []) {
        if (!profile.telegram_user_id) continue;

        const nameParts = (profile.full_name || '').split(' ');
        const calculatedStatus = calculateAccessStatus(profile.user_id, accessMap, manualAccessMap, grantsMap);
        const existing = existingMembersMap.get(profile.telegram_user_id);

        // Preserve removals unless access is restored
        const accessStatus = existing?.access_status === 'removed' && calculatedStatus !== 'ok'
          ? 'removed'
          : calculatedStatus;

        if (accessStatus === 'ok') countActive++;
        else if (accessStatus === 'expired') countExpired++;
        else if (accessStatus === 'removed') countRemoved++;
        else countNoAccess++;

        // Preserve last known presence values
        const access = profile.user_id ? accessMap.get(profile.user_id) : null;
        const inferPresence = (state: string | null | undefined): boolean | null => {
          if (state === 'member' || state === 'active') return true;
          if (state === 'revoked') return false;
          return null;
        };

        membersToUpsert.push({
          club_id: club_id,
          telegram_user_id: profile.telegram_user_id,
          telegram_username: profile.telegram_username,
          telegram_first_name: nameParts[0] || null,
          telegram_last_name: nameParts.slice(1).join(' ') || null,
          profile_id: profile.id,
          link_status: 'linked',
          access_status: accessStatus,
          in_chat: existing?.in_chat ?? inferPresence(access?.state_chat),
          in_channel: existing?.in_channel ?? inferPresence(access?.state_channel),
          last_synced_at: new Date().toISOString(),
        });
      }

      // Add admins
      const adminTelegramIds = new Set<number>();
      if (club.chat_id) {
        const chatAdmins = await getChatAdministrators(botToken, club.chat_id);
        for (const admin of chatAdmins.admins) {
          adminTelegramIds.add(admin.telegram_user_id);
          const idx = membersToUpsert.findIndex(m => m.telegram_user_id === admin.telegram_user_id);
          if (idx >= 0) {
            membersToUpsert[idx].in_chat = true;
          } else {
            membersToUpsert.push({
              club_id, telegram_user_id: admin.telegram_user_id,
              telegram_username: admin.telegram_username,
              telegram_first_name: admin.telegram_first_name,
              telegram_last_name: admin.telegram_last_name,
              profile_id: null, link_status: 'not_linked', access_status: 'no_access',
              in_chat: true, in_channel: false, last_synced_at: new Date().toISOString(),
            });
            countNoAccess++;
          }
        }
      }
      if (club.channel_id) {
        const channelAdmins = await getChatAdministrators(botToken, club.channel_id);
        for (const admin of channelAdmins.admins) {
          const idx = membersToUpsert.findIndex(m => m.telegram_user_id === admin.telegram_user_id);
          if (idx >= 0) {
            membersToUpsert[idx].in_channel = true;
          } else if (!adminTelegramIds.has(admin.telegram_user_id)) {
            membersToUpsert.push({
              club_id, telegram_user_id: admin.telegram_user_id,
              telegram_username: admin.telegram_username,
              telegram_first_name: admin.telegram_first_name,
              telegram_last_name: admin.telegram_last_name,
              profile_id: null, link_status: 'not_linked', access_status: 'no_access',
              in_chat: false, in_channel: true, last_synced_at: new Date().toISOString(),
            });
            countNoAccess++;
          }
        }
      }

      if (membersToUpsert.length > 0) {
        await supabase.from('telegram_club_members').upsert(membersToUpsert, {
          onConflict: 'club_id,telegram_user_id', ignoreDuplicates: false
        });
      }

      const violatorsCount = membersToUpsert.filter(m =>
        ['no_access', 'expired'].includes(m.access_status) && (m.in_chat || m.in_channel)
      ).length;

      await supabase.from('telegram_clubs').update({
        last_members_sync_at: new Date().toISOString(),
        members_count_chat: chatTotal ?? 0,
        members_count_channel: channelTotal ?? 0,
        violators_count: violatorsCount,
      }).eq('id', club_id);

      await logAudit(supabase, {
        club_id, event_type: 'RESYNC', actor_type: 'admin', actor_id: requesterId,
        meta: { total: membersToUpsert.length, active: countActive, expired: countExpired, no_access: countNoAccess, removed: countRemoved },
      });

      return new Response(JSON.stringify({
        success: true,
        members_count: membersToUpsert.length,
        active_count: countActive,
        expired_count: countExpired,
        no_access_count: countNoAccess,
        removed_count: countRemoved,
        violators_count: violatorsCount,
        chat_total_count: chatTotal,
        channel_total_count: channelTotal,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // Action: KICK - Remove violators
    // ==========================================
    if (action === 'kick') {
      const results: { telegram_user_id: number; success: boolean; error?: string }[] = [];
      let query = supabase.from('telegram_club_members').select('*').eq('club_id', club_id).in('access_status', ['no_access', 'expired']);
      if (member_ids?.length > 0) query = query.in('id', member_ids);
      const { data: members } = await query;
      let kickedCount = 0;

      for (const member of members || []) {
        let chatKicked = false, channelKicked = false, lastError: string | undefined;

        if (member.in_chat && club.chat_id) {
          const r = await kickMember(botToken, club.chat_id, member.telegram_user_id);
          chatKicked = r.success;
          if (!r.success) lastError = r.error;
        }
        if (member.in_channel && club.channel_id) {
          const r = await kickMember(botToken, club.channel_id, member.telegram_user_id);
          channelKicked = r.success;
          if (!r.success) lastError = r.error;
        }

        if (chatKicked || channelKicked) {
          kickedCount++;
          await supabase.from('telegram_club_members').update({
            access_status: 'removed',
            in_chat: chatKicked ? false : member.in_chat,
            in_channel: channelKicked ? false : member.in_channel,
            updated_at: new Date().toISOString(),
          }).eq('id', member.id);

          await logAudit(supabase, {
            club_id, user_id: member.profile_id, telegram_user_id: member.telegram_user_id,
            event_type: chatKicked && channelKicked ? 'KICK_BOTH' : chatKicked ? 'KICK_CHAT' : 'KICK_CHANNEL',
            actor_type: 'admin', actor_id: requesterId,
            telegram_chat_result: chatKicked ? { success: true } : null,
            telegram_channel_result: channelKicked ? { success: true } : null,
          });
        }

        results.push({ telegram_user_id: member.telegram_user_id, success: chatKicked || channelKicked, error: lastError });
      }

      return new Response(JSON.stringify({ success: true, kicked_count: kickedCount, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: KICK_PRESENT - Kick only members actually present
    // ==========================================
    if (action === 'kick_present') {
      let query = supabase.from('telegram_club_members').select('*').eq('club_id', club_id).or('in_chat.eq.true,in_channel.eq.true');
      if (member_ids?.length > 0) query = query.in('id', member_ids);
      const { data: members } = await query;

      const results: any[] = [];
      let kickedCount = 0;

      for (const member of members || []) {
        let chatKicked = false, channelKicked = false, lastError: string | undefined;

        if (member.in_chat && club.chat_id) {
          const r = await kickMember(botToken, club.chat_id, member.telegram_user_id);
          chatKicked = r.success;
          if (!r.success) lastError = r.error;
        }
        if (member.in_channel && club.channel_id) {
          const r = await kickMember(botToken, club.channel_id, member.telegram_user_id);
          channelKicked = r.success;
          if (!r.success) lastError = r.error;
        }

        if (chatKicked || channelKicked) {
          kickedCount++;
          await supabase.from('telegram_club_members').update({
            in_chat: chatKicked ? false : member.in_chat,
            in_channel: channelKicked ? false : member.in_channel,
            access_status: 'removed',
            updated_at: new Date().toISOString(),
          }).eq('id', member.id);

          await logAudit(supabase, {
            club_id, user_id: member.profile_id, telegram_user_id: member.telegram_user_id,
            event_type: 'KICK_PRESENT', actor_type: 'admin', actor_id: requesterId,
            telegram_chat_result: { kicked: chatKicked },
            telegram_channel_result: { kicked: channelKicked },
          });
        }

        results.push({ telegram_user_id: member.telegram_user_id, success: chatKicked || channelKicked, error: lastError });
      }

      return new Response(JSON.stringify({ success: true, kicked_count: kickedCount, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: MARK_REMOVED
    // ==========================================
    if (action === 'mark_removed') {
      if (!member_ids?.length) {
        return new Response(JSON.stringify({ success: false, error: 'No member_ids' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase.from('telegram_club_members').update({
        access_status: 'removed', updated_at: new Date().toISOString(),
      }).eq('club_id', club_id).in('id', member_ids);

      await logAudit(supabase, {
        club_id, event_type: 'MARK_REMOVED', actor_type: 'admin', actor_id: requesterId,
        meta: { member_ids, count: member_ids.length },
      });

      return new Response(JSON.stringify({ success: true, marked_count: member_ids.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: PREVIEW - Get violators list
    // ==========================================
    if (action === 'preview') {
      const { data: violators } = await supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club_id)
        .in('access_status', ['no_access', 'expired'])
        .or('in_chat.eq.true,in_channel.eq.true');

      return new Response(JSON.stringify({ success: true, violators: violators || [], count: violators?.length || 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: SEND_MESSAGE - Send DM to member
    // ==========================================
    if (action === 'send_message') {
      const { message, telegram_user_id: targetTgId } = body;
      if (!targetTgId || !message) {
        return new Response(JSON.stringify({ success: false, error: 'telegram_user_id and message required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = await telegramRequest(botToken, 'sendMessage', {
        chat_id: targetTgId,
        text: message,
        parse_mode: 'HTML',
      });

      const success = result.ok;
      const canDm = !result.description?.includes('bot was blocked') && !result.description?.includes("can't initiate");

      await supabase.from('telegram_club_members').update({
        can_dm: canDm, updated_at: new Date().toISOString(),
      }).eq('club_id', club_id).eq('telegram_user_id', targetTgId);

      await logAudit(supabase, {
        club_id, telegram_user_id: targetTgId,
        event_type: success ? 'DM_SENT' : 'DM_FAILED',
        actor_type: 'admin', actor_id: requesterId,
        meta: { message_preview: message.substring(0, 100), error: result.description },
      });

      return new Response(JSON.stringify({ success, error: result.description, can_dm: canDm }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: GET_AUDIT - Get audit history for member
    // ==========================================
    if (action === 'get_audit') {
      const { user_id: targetUserId, telegram_user_id: targetTgId, limit: auditLimit = 50 } = body;

      let query = supabase.from('telegram_access_audit').select('*').eq('club_id', club_id).order('created_at', { ascending: false }).limit(auditLimit);
      if (targetUserId) query = query.eq('user_id', targetUserId);
      if (targetTgId) query = query.eq('telegram_user_id', targetTgId);

      const { data: auditRecords, error: auditError } = await query;

      return new Response(JSON.stringify({ success: true, audit: auditRecords || [], error: auditError?.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: CHECK_LINK
    // ==========================================
    if (action === 'check_link') {
      const diagnostics: any = { profile_id, telegram_user_id, checks: [] };

      if (profile_id) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, user_id, telegram_user_id, telegram_username, telegram_linked_at')
          .eq('id', profile_id)
          .single();
        diagnostics.profile = profile;
        diagnostics.checks.push({
          check: 'profile_exists', passed: !!profile,
          details: profile ? `TG ID: ${profile.telegram_user_id}` : profileError?.message,
        });
      }

      return new Response(JSON.stringify({ success: true, diagnostics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
