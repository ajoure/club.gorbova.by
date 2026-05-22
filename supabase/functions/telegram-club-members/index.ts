import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCommercialAccessBatch } from '../_shared/accessValidation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    console.log(`Banning user ${userId} from chat ${chatId} (permanent, no unban)`);
    
    const banResult = await telegramRequest(botToken, 'banChatMember', {
      chat_id: chatId,
      user_id: userId,
      revoke_messages: false,
      // Ban for 366 days to prevent rejoin via old invite links
      until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
    });

    if (!banResult.ok) {
      if (banResult.description?.includes('user is not a member') ||
          banResult.description?.includes('PARTICIPANT_NOT_EXISTS') ||
          banResult.description?.includes('USER_NOT_PARTICIPANT')) {
        // User not in chat - still try preventive ban
        await telegramRequest(botToken, 'banChatMember', {
          chat_id: chatId,
          user_id: userId,
          until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
        });
        return { success: true, notMember: true };
      }
      if (banResult.description?.includes('not enough rights')) {
        return { success: false, error: banResult.description };
      }
      return { success: false, error: banResult.description };
    }

    // DO NOT UNBAN - this prevents rejoin via old invite links
    // User will be unbanned when access is granted again via telegram-grant-access

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * PATCH P0.9.5: Calculate access status with subscription priority
 * 
 * Приоритет проверки:
 * 1. subscriptions_v2 (HIGHEST) - если есть активная подписка, сразу 'ok'
 * 2. telegram_access.active_until
 * 3. telegram_manual_access.valid_until
 * 4. telegram_access_grants.end_at
 */
function calculateAccessStatus(
  userId: string | undefined,
  accessRecords: Map<string, any>,
  manualAccessMap: Map<string, any>,
  grantsMap: Map<string, any>,
  subscriptionsMap: Map<string, any>, // PATCH P0.9.5: Added subscriptions check
): 'ok' | 'expired' | 'no_access' | 'removed' {
  if (!userId) return 'no_access';

  let hasExpiredAccess = false;
  const now = new Date();

  // PATCH P0.9.5: Check subscription FIRST (HIGHEST PRIORITY)
  const subscription = subscriptionsMap.get(userId);
  if (subscription && ['active', 'trial', 'past_due'].includes(subscription.status)) {
    const accessEndAt = subscription.access_end_at ? new Date(subscription.access_end_at) : null;
    if (!accessEndAt || accessEndAt > now) {
      return 'ok'; // Active subscription = always OK
    }
    hasExpiredAccess = true;
  }

  const access = accessRecords.get(userId);
  if (access) {
    // PATCH: state_chat/state_channel='revoked' takes priority over active_until.
    // active_until is ONLY considered when state is 'active' (not pending/revoked/invited).
    // This prevents "sync puts ok back" after admin revoke.
    const isRevoked = access.state_chat === 'revoked' || access.state_channel === 'revoked';
    const isActive = access.state_chat === 'active' || access.state_channel === 'active';

    if (isRevoked) {
      // State is revoked: telegram_access cannot grant 'ok'.
      // Mark as expired so manual/grants below can still override if needed.
      hasExpiredAccess = true;
      // Do NOT return 'removed' here — continue checking manual & grants.
      // 'removed' is returned only if nothing else grants access.
    } else if (isActive) {
      // State is active — active_until is authoritative
      const activeUntil = access.active_until ? new Date(access.active_until) : null;
      if (!activeUntil || activeUntil > now) return 'ok';
      hasExpiredAccess = true;
    }
    // state='pending'/'invited' etc: do NOT grant 'ok' from active_until alone — wait for real sources.
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

  // If state was revoked and no other source granted access — mark as removed
  if (access) {
    const isRevoked = access.state_chat === 'revoked' || access.state_channel === 'revoked';
    if (isRevoked) return 'removed';
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
      // PATCH-A: Full-sync mode with deterministic pagination
      // If member_ids provided → targeted check; otherwise → full paginated scan
      let members: any[] = [];
      if (member_ids?.length > 0) {
        const { data } = await supabase.from('telegram_club_members').select('*').eq('club_id', club_id).in('id', member_ids);
        members = data || [];
      } else {
        // Full paginated fetch with deterministic order
        const FETCH_BATCH = 200;
        let offset = 0;
        while (true) {
          const { data: batch } = await supabase
            .from('telegram_club_members')
            .select('*')
            .eq('club_id', club_id)
            .order('id')
            .range(offset, offset + FETCH_BATCH - 1);
          if (!batch || batch.length === 0) break;
          members = members.concat(batch);
          offset += FETCH_BATCH;
          if (batch.length < FETCH_BATCH) break;
        }
        console.log(`[check_status] Full scan: fetched ${members.length} members for club ${club_id}`);
      }

      const totalExpected = members.length;
      const results: any[] = [];
      let checkedCount = 0;
      let adminsForced = 0;
      let restoredFromRemoved = 0;

      // Process in batches of 50 for Telegram API rate limiting
      const API_BATCH = 50;
      for (let batchStart = 0; batchStart < members.length; batchStart += API_BATCH) {
        const batch = members.slice(batchStart, batchStart + API_BATCH);
        
        for (const member of batch) {
          let chatResult: { isMember: boolean; status: string; error?: string } | null = null;
          let channelResult: { isMember: boolean; status: string; error?: string } | null = null;

          if (club.chat_id) {
            chatResult = await checkMembership(botToken, club.chat_id, member.telegram_user_id);
          }
          if (club.channel_id) {
            channelResult = await checkMembership(botToken, club.channel_id, member.telegram_user_id);
          }

          // ADMIN INVARIANT: if chat_status is administrator/creator, force in_chat=true
          const chatIsAdmin = chatResult?.status === 'administrator' || chatResult?.status === 'creator';
          const channelIsAdmin = channelResult?.status === 'administrator' || channelResult?.status === 'creator';
          const inChat = chatIsAdmin ? true : (chatResult?.isMember ?? null);
          const inChannel = channelIsAdmin ? true : (channelResult?.isMember ?? null);
          const isAdminOrCreator = chatIsAdmin || channelIsAdmin;

          // Track admin guard activations
          if (isAdminOrCreator) {
            if ((chatIsAdmin && !chatResult?.isMember) || (channelIsAdmin && !channelResult?.isMember)) {
              adminsForced++;
              console.warn(`ADMIN_GUARD: user ${member.telegram_user_id} status=${chatResult?.status || channelResult?.status} forced in_chat/in_channel=true`);
            }
          }

          const wasRemoved = isAdminOrCreator && member.access_status === 'removed';
          if (wasRemoved) {
            restoredFromRemoved++;
            console.log(`ADMIN_GUARD: user ${member.telegram_user_id} restored from removed→ok`);
          }

          // Update member record
          await supabase.from('telegram_club_members').update({
            in_chat: inChat,
            in_channel: inChannel,
            last_telegram_check_at: new Date().toISOString(),
            last_telegram_check_result: { chat: chatResult, channel: channelResult },
            // ADMIN GUARD: restore access_status if admin was incorrectly marked as removed
            ...(wasRemoved ? { access_status: 'ok' } : {}),
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

        // Log progress every batch
        if (members.length > API_BATCH) {
          console.log(`[check_status] Progress: ${Math.min(batchStart + API_BATCH, members.length)}/${members.length} processed`);
        }
      }

      // Update club last check time
      await supabase.from('telegram_clubs').update({
        last_status_check_at: new Date().toISOString(),
      }).eq('id', club_id);

      // Audit log with full-sync metrics
      const inChatCount = results.filter((r: any) => r.in_chat === true).length;
      const notInChatCount = results.filter((r: any) => r.in_chat === false).length;

      await logAudit(supabase, {
        club_id,
        event_type: 'STATUS_CHECK',
        actor_type: 'admin',
        actor_id: requesterId,
        meta: { 
          checked_count: checkedCount, 
          total_expected: totalExpected,
          full_scan: !member_ids?.length,
          admins_forced_in_chat: adminsForced,
          restored_from_removed: restoredFromRemoved,
        },
      });

      await supabase.from('audit_logs').insert({
        action: 'telegram.status_check_completed',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'telegram-club-members',
        meta: {
          club_id,
          checked_count: checkedCount,
          total_expected: totalExpected,
          full_scan: !member_ids?.length,
          in_chat_count: inChatCount,
          not_in_chat_count: notInChatCount,
          admins_forced_in_chat: adminsForced,
          restored_from_removed: restoredFromRemoved,
          sample_ids: results.slice(0, 10).map((r: any) => r.telegram_user_id),
          requester: requesterId || 'internal',
        },
      });

      // STOP-GUARD: log warning if not all processed
      if (checkedCount < totalExpected) {
        console.error(`[check_status] STOP-GUARD VIOLATION: processed ${checkedCount}/${totalExpected}`);
      }

      return new Response(JSON.stringify({
        success: true,
        checked_count: checkedCount,
        total_expected: totalExpected,
        full_scan: !member_ids?.length,
        admins_forced_in_chat: adminsForced,
        restored_from_removed: restoredFromRemoved,
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

      // PATCH P0.9.5: Load active subscriptions with best access_end_at per user
      const { data: subscriptionsData } = await supabase
        .from('subscriptions_v2')
        .select('user_id, status, access_end_at')
        .in('status', ['active', 'trial', 'past_due']);
      
      // Build subscriptionsMap with best subscription per user (max access_end_at, NULL = infinity)
      const subscriptionsMap = new Map<string, any>();
      for (const sub of subscriptionsData || []) {
        const existing = subscriptionsMap.get(sub.user_id);
        if (!existing) {
          subscriptionsMap.set(sub.user_id, sub);
        } else {
          // NULL means infinity, always prefer it
          if (sub.access_end_at === null) {
            subscriptionsMap.set(sub.user_id, sub);
          } else if (existing.access_end_at !== null && new Date(sub.access_end_at) > new Date(existing.access_end_at)) {
            subscriptionsMap.set(sub.user_id, sub);
          }
        }
      }
      console.log(`PATCH P0.9.5: Loaded ${subscriptionsMap.size} users with active subscriptions`);

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
        // PATCH P0.9.5: Pass subscriptionsMap to calculateAccessStatus
        const calculatedStatus = calculateAccessStatus(profile.user_id, accessMap, manualAccessMap, grantsMap, subscriptionsMap);
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
    // PATCH: hasValidAccessBatch guard — не кикать пользователей с активным доступом
    // ==========================================
    if (action === 'kick') {
      const MAX_KICK_PER_RUN = 50;
      const results: { telegram_user_id: number; success: boolean; skipped?: boolean; error?: string }[] = [];
      let query = supabase.from('telegram_club_members').select('*').eq('club_id', club_id).in('access_status', ['no_access', 'expired']);
      if (member_ids?.length > 0) query = query.in('id', member_ids);
      const { data: members } = await query;

      if ((members || []).length > MAX_KICK_PER_RUN) {
        return new Response(JSON.stringify({
          success: false,
          error: 'TOO_MANY_CANDIDATES_STOP',
          count: members!.length,
          max: MAX_KICK_PER_RUN,
          message: `Слишком много кандидатов (${members!.length}). Максимум ${MAX_KICK_PER_RUN} за раз. Выберите конкретных участников.`,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // GUARD: re-validate access for all candidates before kicking
      const membersWithUser = (members || []).filter(m => m.profile_id);
      const profileIds = membersWithUser.map(m => m.profile_id);
      const { data: profileRows } = await supabase
        .from('profiles').select('id, user_id').in('id', profileIds);
      const profileToUserId = new Map((profileRows || []).map(p => [p.id, p.user_id]));

      const userIds = [...new Set((membersWithUser).map(m => profileToUserId.get(m.profile_id)).filter(Boolean))] as string[];
      const accessValidation = userIds.length > 0 ? await hasValidAccessBatch(supabase, userIds, club_id) : new Map();

      let kickedCount = 0, skippedCount = 0;

      for (const member of members || []) {
        const userId = profileToUserId.get(member.profile_id);
        const accessResult = userId ? accessValidation.get(userId) : null;

        // AUTO_GUARD_SKIP: пользователь имеет активный доступ → не кикать
        if (accessResult?.valid) {
          skippedCount++;
          await logAudit(supabase, {
            club_id, user_id: member.profile_id, telegram_user_id: member.telegram_user_id,
            event_type: 'KICK_SKIP_HAS_ACCESS',
            actor_type: 'admin', actor_id: requesterId,
            meta: { reason: 'AUTO_GUARD_SKIP', access_source: accessResult.source },
          });
          results.push({ telegram_user_id: member.telegram_user_id, success: false, skipped: true });
          continue;
        }

        // ADMIN GUARD: skip kick for administrator/creator
        const kickCheckResult = member.last_telegram_check_result as Record<string, any> | null;
        const kChatStatus = kickCheckResult?.chat?.status;
        const kChannelStatus = kickCheckResult?.channel?.status;
        const isKickAdmin = ['administrator', 'creator'].includes(kChatStatus) || ['administrator', 'creator'].includes(kChannelStatus);

        if (isKickAdmin) {
          console.log(`ADMIN_PROTECTED: member ${member.telegram_user_id} is ${kChatStatus || kChannelStatus} — skipping kick`);
          skippedCount++;
          await logAudit(supabase, {
            club_id, user_id: member.profile_id, telegram_user_id: member.telegram_user_id,
            event_type: 'KICK_SKIP_ADMIN_PROTECTED',
            actor_type: 'admin', actor_id: requesterId,
            meta: { chat_status: kChatStatus, channel_status: kChannelStatus },
          });
          results.push({ telegram_user_id: member.telegram_user_id, success: false, skipped: true });
          continue;
        }

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

      return new Response(JSON.stringify({ success: true, kicked_count: kickedCount, skipped_count: skippedCount, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: KICK_PRESENT - Kick only members actually present
    // PATCH A: hasValidAccessBatch guard — не кикать пользователей с активным доступом
    // PATCH C: dry_run режим — возвращает кандидатов без реального кика
    // PATCH E: MAX_KICK_PER_RUN STOP-guard
    // ==========================================
    if (action === 'kick_present') {
      const MAX_KICK_PER_RUN = 50;
      const { dry_run = false } = body;

      let query = supabase.from('telegram_club_members').select('*').eq('club_id', club_id).or('in_chat.eq.true,in_channel.eq.true');
      if (member_ids?.length > 0) query = query.in('id', member_ids);
      const { data: members } = await query;

      // Map profile_id → user_id
      const membersWithProfile = (members || []).filter(m => m.profile_id);
      const profileIds = membersWithProfile.map(m => m.profile_id);
      const { data: profileRows } = await supabase
        .from('profiles').select('id, user_id').in('id', profileIds);
      const profileToUserId = new Map((profileRows || []).map(p => [p.id, p.user_id]));

      const userIds = [...new Set(membersWithProfile.map(m => profileToUserId.get(m.profile_id)).filter(Boolean))] as string[];

      // GUARD: re-validate access for all candidates
      const accessValidation = userIds.length > 0 ? await hasValidAccessBatch(supabase, userIds, club_id) : new Map();

      const candidatesToKick: any[] = [];
      const skippedHasAccess: any[] = [];

      for (const member of members || []) {
        const userId = profileToUserId.get(member.profile_id);
        const accessResult = userId ? accessValidation.get(userId) : null;

        // ADMIN GUARD: skip kick for administrator/creator
        const kpCheckResult = member.last_telegram_check_result as Record<string, any> | null;
        const kpChatStatus = kpCheckResult?.chat?.status;
        const kpChannelStatus = kpCheckResult?.channel?.status;
        const isKpAdmin = ['administrator', 'creator'].includes(kpChatStatus) || ['administrator', 'creator'].includes(kpChannelStatus);

        if (isKpAdmin) {
          skippedHasAccess.push({
            telegram_user_id: member.telegram_user_id,
            telegram_username: member.telegram_username,
            access_source: 'admin_protected',
          });
        } else if (accessResult?.valid) {
          // AUTO_GUARD_SKIP: активный доступ → пропускаем
          skippedHasAccess.push({
            telegram_user_id: member.telegram_user_id,
            telegram_username: member.telegram_username,
            access_source: accessResult.source,
          });
        } else {
          candidatesToKick.push(member);
        }
      }

      // DRY RUN: только превью, без кика
      if (dry_run) {
        return new Response(JSON.stringify({
          success: true,
          dry_run: true,
          candidates_count: candidatesToKick.length,
          skipped_has_access_count: skippedHasAccess.length,
          candidates: candidatesToKick.map(m => ({
            id: m.id,
            telegram_user_id: m.telegram_user_id,
            telegram_username: m.telegram_username,
            in_chat: m.in_chat,
            in_channel: m.in_channel,
          })),
          skipped_has_access: skippedHasAccess,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // STOP-guard: слишком много кандидатов
      if (candidatesToKick.length > MAX_KICK_PER_RUN) {
        return new Response(JSON.stringify({
          success: false,
          error: 'TOO_MANY_CANDIDATES_STOP',
          count: candidatesToKick.length,
          max: MAX_KICK_PER_RUN,
          message: `Слишком много кандидатов без доступа (${candidatesToKick.length}). Максимум ${MAX_KICK_PER_RUN} за раз. Выберите конкретных участников.`,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const results: any[] = [];
      let kickedCount = 0;

      for (const member of candidatesToKick) {
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
            meta: { skipped_with_access: skippedHasAccess.length },
          });
        }

        results.push({ telegram_user_id: member.telegram_user_id, success: chatKicked || channelKicked, error: lastError });
      }

      // Log skips
      if (skippedHasAccess.length > 0) {
        await logAudit(supabase, {
          club_id,
          event_type: 'KICK_PRESENT_SKIP_SUMMARY',
          actor_type: 'admin', actor_id: requesterId,
          meta: { skipped_count: skippedHasAccess.length, kicked_count: kickedCount },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        kicked_count: kickedCount,
        skipped_has_access_count: skippedHasAccess.length,
        results,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    // ==========================================
    // Action: REINVITE_GHOSTS — dry_run / execute for "bought but not joined"
    // ==========================================
    if (action === 'reinvite_ghosts') {
      const { scope: reinviteScope, dry_run } = body;
      // scope: 'bought_not_joined' | 'all_not_in_chat' | 'selected_ids'
      const isDryRun = dry_run !== false; // default true

      // Build query for candidates
      let query = supabase
        .from('telegram_club_members')
        .select('id, telegram_user_id, profile_id, in_chat, in_channel, invite_sent_at, invite_status, access_status, link_status')
        .eq('club_id', club_id)
        .eq('link_status', 'linked')
        .not('telegram_user_id', 'is', null);

      if (reinviteScope === 'selected_ids' && member_ids?.length > 0) {
        query = query.in('id', member_ids);
      } else {
        query = query.eq('access_status', 'ok').or('in_chat.eq.false,in_channel.eq.false');
      }

      const { data: candidates } = await query.limit(100);

      if (!candidates?.length) {
        return new Response(JSON.stringify({
          success: true,
          dry_run: isDryRun,
          will_send: 0,
          skipped: [],
          candidates: [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Check reinvite limits and filter
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

      const willSend: typeof candidates = [];
      const skipped: { id: string; telegram_user_id: number; reason: string }[] = [];

      for (const c of candidates) {
        // Skip if invite sent < 4h ago
        if (c.invite_sent_at && c.invite_sent_at > fourHoursAgo) {
          skipped.push({ id: c.id, telegram_user_id: c.telegram_user_id, reason: 'invite_sent_recently' });
          continue;
        }

        // Check reinvite count in last 24h
        const { count } = await supabase
          .from('telegram_invite_links')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', club_id)
          .eq('profile_id', c.profile_id)
          .gte('sent_at', twentyFourHoursAgo)
          .in('source', ['reinvite', 'cron_reinvite']);

        if ((count || 0) >= 3) {
          skipped.push({ id: c.id, telegram_user_id: c.telegram_user_id, reason: 'max_reinvites_24h' });
          continue;
        }

        // Check mismatch count
        const { count: mismatchCount } = await supabase
          .from('telegram_invite_links')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', club_id)
          .eq('profile_id', c.profile_id)
          .eq('status', 'mismatch')
          .gte('created_at', twentyFourHoursAgo);

        if ((mismatchCount || 0) >= 2) {
          skipped.push({ id: c.id, telegram_user_id: c.telegram_user_id, reason: 'security_review' });
          continue;
        }

        willSend.push(c);
        if (willSend.length >= 50) break; // Max 50 per batch
      }

      if (isDryRun) {
        return new Response(JSON.stringify({
          success: true,
          dry_run: true,
          will_send: willSend.length,
          will_send_ids: willSend.map(c => c.id),
          skipped_count: skipped.length,
          skipped,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Execute: queue items for telegram_access_queue
      let queuedCount = 0;
      for (const c of willSend) {
        // Get user_id from profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('id', c.profile_id)
          .maybeSingle();

        if (profile?.user_id) {
          await supabase.from('telegram_access_queue').insert({
            user_id: profile.user_id,
            club_id: club_id,
            action: 'grant',
            // SOURCE-TAG required by telegram-process-access-queue source-guard.
            // Without meta.source ∈ {reinvite, manual_bulk, repair, admin_backfill}
            // the queue item is treated as a stray legacy insert and skipped.
            meta: { source: 'reinvite' },
          });
          queuedCount++;
        }
      }

      await logAudit(supabase, {
        club_id: club_id,
        event_type: 'REINVITE_GHOSTS',
        actor_type: 'admin',
        actor_id: requesterId,
        meta: {
          scope: reinviteScope,
          queued_count: queuedCount,
          skipped_count: skipped.length,
          skipped_reasons: skipped.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] || 0) + 1; return acc; }, {} as Record<string, number>),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        dry_run: false,
        queued_count: queuedCount,
        skipped_count: skipped.length,
        skipped,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
