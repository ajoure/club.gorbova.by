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

async function getChatMemberCount(botToken: string, chatId: number): Promise<{ count?: number; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await response.json();
    if (!data.ok) {
      return { error: data.description || 'Failed to get member count' };
    }
    return { count: data.result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function getChatAdministrators(
  botToken: string,
  chatId: number,
): Promise<{ admins: { telegram_user_id: number; telegram_username?: string; telegram_first_name?: string; telegram_last_name?: string }[]; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await response.json();

    const admins: { telegram_user_id: number; telegram_username?: string; telegram_first_name?: string; telegram_last_name?: string }[] = [];
    if (data.ok && data.result) {
      for (const admin of data.result) {
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

async function kickMember(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    // Ban the user
    const banResponse = await fetch(`https://api.telegram.org/bot${botToken}/banChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        user_id: userId,
        revoke_messages: false,
      }),
    });
    const banData = await banResponse.json();
    
    if (!banData.ok) {
      return { success: false, error: banData.description };
    }

    // Immediately unban to allow rejoin with proper invite (kick without blacklist)
    await fetch(`https://api.telegram.org/bot${botToken}/unbanChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        user_id: userId,
        only_if_banned: true,
      }),
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Calculate access status: 'ok' | 'expired' | 'no_access'
function calculateAccessStatus(
  userId: string | undefined,
  accessRecords: Map<string, any>,
  manualAccessMap: Map<string, any>,
  grantsMap: Map<string, any>,
  adminUserIds: Set<string>,
): 'ok' | 'expired' | 'no_access' {
  // Admins always have access
  if (userId && adminUserIds.has(userId)) {
    return 'ok';
  }
  
  if (!userId) {
    return 'no_access';
  }

  let hasExpiredAccess = false;
  const now = new Date();

  // Check telegram_access
  const access = accessRecords.get(userId);
  if (access) {
    const activeUntil = access.active_until ? new Date(access.active_until) : null;
    if (!activeUntil || activeUntil > now) {
      return 'ok';
    }
    hasExpiredAccess = true;
  }

  // Check manual_access
  const manual = manualAccessMap.get(userId);
  if (manual && manual.is_active) {
    const validUntil = manual.valid_until ? new Date(manual.valid_until) : null;
    if (!validUntil || validUntil > now) {
      return 'ok';
    }
    hasExpiredAccess = true;
  }

  // Check access_grants
  const grant = grantsMap.get(userId);
  if (grant && grant.status === 'active') {
    const endAt = grant.end_at ? new Date(grant.end_at) : null;
    if (!endAt || endAt > now) {
      return 'ok';
    }
    hasExpiredAccess = true;
  }

  return hasExpiredAccess ? 'expired' : 'no_access';
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

    // Use service role for actual operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // For calls coming from the web app, enforce auth + admin check.
    let requesterLabel = 'internal';

    if (!isServiceInvocation) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authorization required' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: hasPermission } = await userClient.rpc('has_permission', {
        _user_id: user.id,
        _permission_code: 'telegram.clubs.manage',
      });

      const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
      const { data: isSuperAdmin } = await userClient.rpc('is_super_admin', { _user_id: user.id });

      const isAdmin = !!hasPermission || !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';
      if (!isAdmin) {
        console.log(`Access denied for user ${user.email}: hasPermission=${hasPermission}, isSuperAdmin=${isSuperAdmin}, userRole=${userRole}`);
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      requesterLabel = user.email ?? user.id;
    }

    const { action, club_id, member_ids } = await req.json();
    console.log(`Club members action: ${action}, club_id: ${club_id}, requester: ${requesterLabel}`);

    // Get club with bot
    const { data: club, error: clubError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('id', club_id)
      .single();

    if (clubError || !club) {
      return new Response(JSON.stringify({ success: false, error: 'Club not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = club.telegram_bots?.bot_token_encrypted;
    if (!botToken) {
      return new Response(JSON.stringify({ success: false, error: 'Bot token not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: SYNC - Synchronize members from DB
    // ==========================================
    if (action === 'sync') {
      console.log('Starting sync for club:', club_id);
      
      // Get Telegram stats (only counts and admins available via Bot API)
      let chatTotal: number | undefined;
      let channelTotal: number | undefined;
      let chatWarning: string | undefined;
      let channelWarning: string | undefined;

      if (club.chat_id) {
        const countResult = await getChatMemberCount(botToken, club.chat_id);
        chatTotal = countResult.count;
        if (countResult.error) {
          chatWarning = countResult.error;
        }
      }

      if (club.channel_id) {
        const countResult = await getChatMemberCount(botToken, club.channel_id);
        channelTotal = countResult.count;
        if (countResult.error) {
          channelWarning = countResult.error;
        }
      }

      // =====================================================
      // CORE FIX: Source of truth is our database, NOT Telegram API
      // Get ALL profiles with linked Telegram accounts
      // =====================================================
      const { data: allProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, telegram_user_id, telegram_username, full_name, telegram_linked_at')
        .not('telegram_user_id', 'is', null);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        return new Response(JSON.stringify({ success: false, error: 'Failed to fetch profiles' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Found ${allProfiles?.length || 0} profiles with linked Telegram`);

      // Get admin user IDs
      const { data: adminRolesV2 } = await supabase
        .from('user_roles_v2')
        .select('user_id, roles!inner(code)')
        .in('roles.code', ['admin', 'super_admin']);
      
      const adminUserIds = new Set<string>(adminRolesV2?.map(r => r.user_id) || []);

      const { data: legacyAdmins } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'superadmin']);
      
      legacyAdmins?.forEach(r => adminUserIds.add(r.user_id));

      // Get ALL access records for this club
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

      // Build members list from ALL linked profiles
      const membersToUpsert: any[] = [];
      let countActive = 0;
      let countExpired = 0;
      let countNoAccess = 0;

      for (const profile of allProfiles || []) {
        if (!profile.telegram_user_id) continue;

        const nameParts = (profile.full_name || '').split(' ');
        const accessStatus = calculateAccessStatus(
          profile.user_id,
          accessMap,
          manualAccessMap,
          grantsMap,
          adminUserIds,
        );

        // Track counts
        if (accessStatus === 'ok') countActive++;
        else if (accessStatus === 'expired') countExpired++;
        else countNoAccess++;

        // Get presence info from access records (we can't check Telegram API for regular members)
        const access = accessMap.get(profile.user_id);
        const inChat = access?.state_chat === 'member' || access?.state_chat === 'active';
        const inChannel = access?.state_channel === 'member' || access?.state_channel === 'active';

        membersToUpsert.push({
          club_id: club_id,
          telegram_user_id: profile.telegram_user_id,
          telegram_username: profile.telegram_username,
          telegram_first_name: nameParts[0] || null,
          telegram_last_name: nameParts.slice(1).join(' ') || null,
          profile_id: profile.id,
          link_status: 'linked',
          access_status: accessStatus,
          in_chat: inChat || false,
          in_channel: inChannel || false,
          last_synced_at: new Date().toISOString(),
        });
      }

      // Also get Telegram admins for presence info (they might not be in our profiles)
      const adminTelegramIds = new Set<number>();
      if (club.chat_id) {
        const chatAdmins = await getChatAdministrators(botToken, club.chat_id);
        for (const admin of chatAdmins.admins) {
          adminTelegramIds.add(admin.telegram_user_id);
          // Check if this admin is already in our list
          const existingIndex = membersToUpsert.findIndex(m => m.telegram_user_id === admin.telegram_user_id);
          if (existingIndex >= 0) {
            membersToUpsert[existingIndex].in_chat = true;
          } else {
            // Admin not in our profiles - add as unlinked
            membersToUpsert.push({
              club_id: club_id,
              telegram_user_id: admin.telegram_user_id,
              telegram_username: admin.telegram_username,
              telegram_first_name: admin.telegram_first_name,
              telegram_last_name: admin.telegram_last_name,
              profile_id: null,
              link_status: 'not_linked',
              access_status: 'no_access',
              in_chat: true,
              in_channel: false,
              last_synced_at: new Date().toISOString(),
            });
            countNoAccess++;
          }
        }
      }

      if (club.channel_id) {
        const channelAdmins = await getChatAdministrators(botToken, club.channel_id);
        for (const admin of channelAdmins.admins) {
          const existingIndex = membersToUpsert.findIndex(m => m.telegram_user_id === admin.telegram_user_id);
          if (existingIndex >= 0) {
            membersToUpsert[existingIndex].in_channel = true;
          } else if (!adminTelegramIds.has(admin.telegram_user_id)) {
            membersToUpsert.push({
              club_id: club_id,
              telegram_user_id: admin.telegram_user_id,
              telegram_username: admin.telegram_username,
              telegram_first_name: admin.telegram_first_name,
              telegram_last_name: admin.telegram_last_name,
              profile_id: null,
              link_status: 'not_linked',
              access_status: 'no_access',
              in_chat: false,
              in_channel: true,
              last_synced_at: new Date().toISOString(),
            });
            countNoAccess++;
          }
        }
      }

      console.log(`Syncing ${membersToUpsert.length} members: ${countActive} active, ${countExpired} expired, ${countNoAccess} no_access`);

      // Upsert all members
      if (membersToUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('telegram_club_members')
          .upsert(membersToUpsert, { 
            onConflict: 'club_id,telegram_user_id',
            ignoreDuplicates: false 
          });

        if (upsertError) {
          console.error('Upsert error:', upsertError);
          return new Response(JSON.stringify({ success: false, error: 'Failed to save members' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Calculate violators (in chat/channel but no access)
      const violatorsCount = membersToUpsert.filter(m => 
        m.access_status === 'no_access' && (m.in_chat || m.in_channel)
      ).length;

      // Update club stats
      await supabase
        .from('telegram_clubs')
        .update({
          last_members_sync_at: new Date().toISOString(),
          members_count_chat: chatTotal ?? 0,
          members_count_channel: channelTotal ?? 0,
          violators_count: violatorsCount,
        })
        .eq('id', club_id);

      // Log sync event
      await supabase.from('telegram_logs').insert({
        club_id: club_id,
        action: 'MEMBERS_SYNC',
        status: 'ok',
        meta: {
          total: membersToUpsert.length,
          active: countActive,
          expired: countExpired,
          no_access: countNoAccess,
          violators: violatorsCount,
          telegram_chat_total: chatTotal,
          telegram_channel_total: channelTotal,
        },
      });

      // Generate warning message for Telegram API limitations
      let apiWarning: string | undefined;
      if (chatTotal && chatTotal > (membersToUpsert.filter(m => m.in_chat).length + 5)) {
        apiWarning = `Telegram Bot API не позволяет получить полный список участников. Список формируется из привязок в системе (${membersToUpsert.length}). В Telegram: чат ~${chatTotal}, канал ~${channelTotal || 0}.`;
      }

      return new Response(JSON.stringify({
        success: true,
        members_count: membersToUpsert.length,
        active_count: countActive,
        expired_count: countExpired,
        no_access_count: countNoAccess,
        violators_count: violatorsCount,
        chat_total_count: chatTotal,
        channel_total_count: channelTotal,
        chat_warning: chatWarning || apiWarning,
        channel_warning: channelWarning,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: KICK - Remove violators
    // ==========================================
    if (action === 'kick') {
      const results: { telegram_user_id: number; success: boolean; error?: string }[] = [];

      // Get members to kick
      let query = supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club_id)
        .eq('access_status', 'no_access');

      if (member_ids && member_ids.length > 0) {
        query = query.in('id', member_ids);
      }

      const { data: members } = await query;
      let kickedCount = 0;

      for (const member of members || []) {
        let kickSuccess = true;
        let kickError: string | undefined;

        // Kick from chat
        if (member.in_chat && club.chat_id) {
          const chatResult = await kickMember(botToken, club.chat_id, member.telegram_user_id);
          if (!chatResult.success) {
            kickSuccess = false;
            kickError = chatResult.error;
          }
        }

        // Kick from channel
        if (kickSuccess && member.in_channel && club.channel_id) {
          const channelResult = await kickMember(botToken, club.channel_id, member.telegram_user_id);
          if (!channelResult.success) {
            kickSuccess = false;
            kickError = channelResult.error;
          }
        }

        if (kickSuccess) {
          kickedCount++;
          // Update member status
          await supabase
            .from('telegram_club_members')
            .update({ 
              access_status: 'removed',
              in_chat: false,
              in_channel: false,
            })
            .eq('id', member.id);

          // Log kick
          await supabase.from('telegram_logs').insert({
            user_id: member.profile_id,
            club_id: club_id,
            action: 'KICK',
            target: `@${member.telegram_username || member.telegram_user_id}`,
            status: 'ok',
            meta: { telegram_user_id: member.telegram_user_id },
          });
        }

        results.push({ 
          telegram_user_id: member.telegram_user_id, 
          success: kickSuccess, 
          error: kickError 
        });
      }

      // Update violators count
      const { count: newViolatorsCount } = await supabase
        .from('telegram_club_members')
        .select('*', { count: 'exact', head: true })
        .eq('club_id', club_id)
        .eq('access_status', 'no_access')
        .or('in_chat.eq.true,in_channel.eq.true');

      await supabase
        .from('telegram_clubs')
        .update({ violators_count: newViolatorsCount || 0 })
        .eq('id', club_id);

      return new Response(JSON.stringify({
        success: true,
        kicked_count: kickedCount,
        results: results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: PREVIEW - Get list of violators
    // ==========================================
    if (action === 'preview') {
      const { data: violators } = await supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club_id)
        .eq('access_status', 'no_access')
        .or('in_chat.eq.true,in_channel.eq.true');

      return new Response(JSON.stringify({
        success: true,
        violators: violators || [],
        count: violators?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: CHECK_LINK - Verify user link status
    // ==========================================
    if (action === 'check_link') {
      const { profile_id, telegram_user_id } = await req.json();
      
      const diagnostics: any = {
        profile_id,
        telegram_user_id,
        checks: [],
      };

      // Check profile
      if (profile_id) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, user_id, telegram_user_id, telegram_username, telegram_linked_at')
          .eq('id', profile_id)
          .single();
        
        diagnostics.profile = profile;
        diagnostics.profile_error = profileError?.message;
        diagnostics.checks.push({
          check: 'profile_exists',
          passed: !!profile && !profileError,
          details: profile ? `Telegram ID: ${profile.telegram_user_id}` : profileError?.message,
        });
      }

      // Check club member record
      const memberQuery = telegram_user_id 
        ? { club_id, telegram_user_id }
        : profile_id
          ? { club_id, profile_id }
          : null;

      if (memberQuery) {
        const { data: member, error: memberError } = await supabase
          .from('telegram_club_members')
          .select('*')
          .match(memberQuery)
          .single();
        
        diagnostics.member = member;
        diagnostics.member_error = memberError?.message;
        diagnostics.checks.push({
          check: 'member_record_exists',
          passed: !!member && !memberError,
          details: member ? `Status: ${member.access_status}` : memberError?.message,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        diagnostics,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
