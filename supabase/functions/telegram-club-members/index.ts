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
  in_chat: boolean;
  in_channel: boolean;
}

async function getChatMembers(botToken: string, chatId: number): Promise<{ members: ClubMember[]; error?: string }> {
  try {
    // Get chat member count first
    const countResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const countData = await countResponse.json();
    
    if (!countData.ok) {
      return { members: [], error: countData.description || 'Failed to get member count' };
    }

    // For channels, we can't get members list via Bot API
    // We need to use getChatAdministrators which only returns admins
    // Full member list requires MTProto API which is not available in bots
    
    // Try to get administrators at minimum
    const adminsResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const adminsData = await adminsResponse.json();
    
    const members: ClubMember[] = [];
    
    if (adminsData.ok && adminsData.result) {
      for (const admin of adminsData.result) {
        if (!admin.user.is_bot) {
          members.push({
            telegram_user_id: admin.user.id,
            telegram_username: admin.user.username,
            telegram_first_name: admin.user.first_name,
            telegram_last_name: admin.user.last_name,
            in_chat: false, // Will be set correctly based on source
            in_channel: false,
          });
        }
      }
    }

    return { 
      members, 
      error: countData.result > members.length 
        ? `API возвращает только администраторов (${members.length} из ${countData.result}). Полный список участников недоступен через Bot API.` 
        : undefined 
    };
  } catch (error) {
    console.error('Error getting chat members:', error);
    return { members: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function kickMember(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/banChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        user_id: userId,
        revoke_messages: false,
      }),
    });
    const data = await response.json();
    
    if (!data.ok) {
      return { success: false, error: data.description };
    }

    // Immediately unban to allow rejoin with proper invite
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Verify user is authenticated and has admin access
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has admin permissions
    const { data: hasPermission } = await userClient.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'telegram.clubs.manage'
    });

    // Also check legacy roles
    const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
    
    const isAdmin = hasPermission || userRole === 'admin' || userRole === 'superadmin';
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role for actual operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, club_id, member_ids } = await req.json();
    console.log(`Club members action: ${action}, club_id: ${club_id}, user: ${user.email}`);

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

    // Action: SYNC - Synchronize members from Telegram
    if (action === 'sync') {
      const allMembers: Map<number, ClubMember> = new Map();
      let chatError: string | undefined;
      let channelError: string | undefined;

      // Get chat members
      if (club.chat_id) {
        const chatResult = await getChatMembers(botToken, club.chat_id);
        chatError = chatResult.error;
        for (const member of chatResult.members) {
          const existing = allMembers.get(member.telegram_user_id);
          allMembers.set(member.telegram_user_id, {
            ...member,
            in_chat: true,
            in_channel: existing?.in_channel || false,
          });
        }
      }

      // Get channel members
      if (club.channel_id) {
        const channelResult = await getChatMembers(botToken, club.channel_id);
        channelError = channelResult.error;
        for (const member of channelResult.members) {
          const existing = allMembers.get(member.telegram_user_id);
          allMembers.set(member.telegram_user_id, {
            ...(existing || member),
            in_chat: existing?.in_chat || false,
            in_channel: true,
          });
        }
      }

      // Get all profiles with telegram_user_id to match
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, user_id, telegram_user_id')
        .not('telegram_user_id', 'is', null);

      const profileMap = new Map(profiles?.map(p => [p.telegram_user_id, p]) || []);

      // Get existing access records
      const { data: accessRecords } = await supabase
        .from('telegram_access')
        .select('user_id, state_chat, state_channel, active_until')
        .eq('club_id', club_id);

      const accessMap = new Map(accessRecords?.map(a => [a.user_id, a]) || []);

      // Upsert members
      let violatorsCount = 0;
      const membersToUpsert = [];

      for (const [tgUserId, member] of allMembers) {
        const profile = profileMap.get(tgUserId);
        const access = profile ? accessMap.get(profile.user_id) : null;
        
        let accessStatus = 'no_access';
        if (profile && access) {
          const isActive = access.active_until ? new Date(access.active_until) > new Date() : true;
          accessStatus = isActive ? 'ok' : 'expired';
        } else if (!profile) {
          accessStatus = 'no_access';
          violatorsCount++;
        }

        membersToUpsert.push({
          club_id: club_id,
          telegram_user_id: tgUserId,
          telegram_username: member.telegram_username,
          telegram_first_name: member.telegram_first_name,
          telegram_last_name: member.telegram_last_name,
          in_chat: member.in_chat,
          in_channel: member.in_channel,
          profile_id: profile?.id || null,
          link_status: profile ? 'linked' : 'not_linked',
          access_status: accessStatus,
          last_synced_at: new Date().toISOString(),
        });
      }

      if (membersToUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('telegram_club_members')
          .upsert(membersToUpsert, { 
            onConflict: 'club_id,telegram_user_id',
            ignoreDuplicates: false 
          });

        if (upsertError) {
          console.error('Upsert error:', upsertError);
        }
      }

      // Update club stats
      await supabase
        .from('telegram_clubs')
        .update({
          last_members_sync_at: new Date().toISOString(),
          members_count_chat: [...allMembers.values()].filter(m => m.in_chat).length,
          members_count_channel: [...allMembers.values()].filter(m => m.in_channel).length,
          violators_count: violatorsCount,
        })
        .eq('id', club_id);

      return new Response(JSON.stringify({ 
        success: true, 
        members_count: allMembers.size,
        violators_count: violatorsCount,
        chat_warning: chatError,
        channel_warning: channelError,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: KICK - Remove violators
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

      for (const member of members || []) {
        // Kick from chat
        if (member.in_chat && club.chat_id) {
          const chatResult = await kickMember(botToken, club.chat_id, member.telegram_user_id);
          if (!chatResult.success) {
            results.push({ telegram_user_id: member.telegram_user_id, success: false, error: chatResult.error });
            continue;
          }
        }

        // Kick from channel
        if (member.in_channel && club.channel_id) {
          const channelResult = await kickMember(botToken, club.channel_id, member.telegram_user_id);
          if (!channelResult.success) {
            results.push({ telegram_user_id: member.telegram_user_id, success: false, error: channelResult.error });
            continue;
          }
        }

        // Update member status
        await supabase
          .from('telegram_club_members')
          .update({ 
            in_chat: false, 
            in_channel: false,
            access_status: 'removed',
          })
          .eq('id', member.id);

        // Log the action
        await supabase.from('telegram_logs').insert({
          club_id: club_id,
          action: 'KICK_VIOLATOR',
          target: `tg_user_${member.telegram_user_id}`,
          status: 'ok',
          meta: { 
            telegram_user_id: member.telegram_user_id,
            telegram_username: member.telegram_username,
          },
        });

        results.push({ telegram_user_id: member.telegram_user_id, success: true });
      }

      // Update violators count
      const { count } = await supabase
        .from('telegram_club_members')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', club_id)
        .eq('access_status', 'no_access');

      await supabase
        .from('telegram_clubs')
        .update({ violators_count: count || 0 })
        .eq('id', club_id);

      return new Response(JSON.stringify({ 
        success: true, 
        results,
        kicked_count: results.filter(r => r.success).length,
        failed_count: results.filter(r => !r.success).length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: PREVIEW - Get list of violators for preview
    if (action === 'preview') {
      const { data: violators } = await supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club_id)
        .eq('access_status', 'no_access');

      return new Response(JSON.stringify({ 
        success: true, 
        violators: violators || [],
        count: violators?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Club members error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
