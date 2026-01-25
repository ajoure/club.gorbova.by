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

async function kickUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string }> {
  console.log(`Banning violator ${userId} from chat ${chatId} (permanent, no unban)`);
  
  const result = await telegramRequest(botToken, 'banChatMember', {
    chat_id: chatId,
    user_id: userId,
    // Ban for 366 days to prevent rejoin via old invite links
    until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
  });
  
  if (!result.ok) {
    if (result.description?.includes('user is not a member') || 
        result.description?.includes('PARTICIPANT_NOT_EXISTS') ||
        result.description?.includes('USER_NOT_PARTICIPANT')) {
      // Still try preventive ban
      await telegramRequest(botToken, 'banChatMember', {
        chat_id: chatId,
        user_id: userId,
        until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
      });
      return { success: true };
    }
    return { success: false, error: result.description };
  }
  
  // DO NOT UNBAN - this prevents rejoin via old invite links
  // User will be unbanned when access is granted again via telegram-grant-access
  
  return { success: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting expired access and violator check...');

    const now = new Date().toISOString();

    // 1. Find all active telegram_access records that have expired
    const { data: expiredAccess, error: queryError } = await supabase
      .from('telegram_access')
      .select(`
        id,
        user_id,
        club_id,
        state_chat,
        state_channel,
        active_until,
        telegram_clubs(*, telegram_bots(*))
      `)
      .or('state_chat.eq.active,state_channel.eq.active')
      .lt('active_until', now);

    if (queryError) {
      console.error('Failed to query expired access:', queryError);
      throw queryError;
    }

    console.log(`Found ${expiredAccess?.length || 0} expired access records`);

    const results = {
      processed: 0,
      revoked: 0,
      skipped: 0,
      errors: 0,
      violators_kicked: 0,
    };

    for (const access of expiredAccess || []) {
      results.processed++;
      
      // Check if user has active manual access for this club
      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('*')
        .eq('user_id', access.user_id)
        .eq('club_id', access.club_id)
        .eq('is_active', true)
        .or(`valid_until.is.null,valid_until.gt.${now}`)
        .maybeSingle();

      if (manualAccess) {
        console.log(`User ${access.user_id} has active manual access, skipping`);
        results.skipped++;
        continue;
      }

      // PATCH 11B: Check if user has active entitlement (club product)
      const { data: activeEntitlement } = await supabase
        .from('entitlements')
        .select('id, product_code, expires_at')
        .eq('user_id', access.user_id)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1)
        .maybeSingle();

      if (activeEntitlement) {
        console.log(`User ${access.user_id} has active entitlement ${activeEntitlement.product_code}, skipping revoke`);
        // Update access record to match entitlement expiry
        await supabase
          .from('telegram_access')
          .update({ 
            active_until: activeEntitlement.expires_at || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            last_sync_at: now,
          })
          .eq('id', access.id);
        results.skipped++;
        continue;
      }

      // Check if user has active telegram_access_grants (renewed subscription)
      const { data: activeGrant } = await supabase
        .from('telegram_access_grants')
        .select('*')
        .eq('user_id', access.user_id)
        .eq('club_id', access.club_id)
        .eq('status', 'active')
        .gt('end_at', now)
        .maybeSingle();

      if (activeGrant) {
        // Subscription renewed, update access record
        console.log(`User ${access.user_id} has renewed subscription, updating access`);
        await supabase
          .from('telegram_access')
          .update({ 
            active_until: activeGrant.end_at,
            last_sync_at: now,
          })
          .eq('id', access.id);
        
        results.skipped++;
        continue;
      }

      // PATCH 11B: Check if user has active subscription
      const { data: activeSub } = await supabase
        .from('subscriptions_v2')
        .select('id, access_end_at')
        .eq('user_id', access.user_id)
        .in('status', ['active', 'trial', 'past_due'])
        .gt('access_end_at', now)
        .limit(1)
        .maybeSingle();

      if (activeSub) {
        console.log(`User ${access.user_id} has active subscription, updating access`);
        await supabase
          .from('telegram_access')
          .update({ 
            active_until: activeSub.access_end_at,
            last_sync_at: now,
          })
          .eq('id', access.id);
        results.skipped++;
        continue;
      }

      // Revoke access
      console.log(`Revoking access for user ${access.user_id} in club ${access.club_id}`);
      
      try {
        const revokeResponse = await supabase.functions.invoke('telegram-revoke-access', {
          body: { 
            user_id: access.user_id, 
            club_id: access.club_id,
            reason: 'subscription_expired'
          },
        });

        if (revokeResponse.error) {
          console.error(`Revoke error for ${access.user_id}:`, revokeResponse.error);
          results.errors++;
        } else {
          results.revoked++;
        }

        // Update telegram_access_grants status
        await supabase
          .from('telegram_access_grants')
          .update({
            status: 'expired',
            revoked_at: now,
            revoke_reason: 'subscription_expired',
          })
          .eq('user_id', access.user_id)
          .eq('club_id', access.club_id)
          .eq('status', 'active')
          .lte('end_at', now);

      } catch (err) {
        console.error(`Error revoking for ${access.user_id}:`, err);
        results.errors++;
      }
    }

    // 2. Kick violators from clubs that have autokick enabled
    // CRITICAL: Only process clubs with autokick_no_access = true
    // Violators = people in chat/channel who don't have access_status = 'ok'
    const { data: clubs } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('is_active', true)
      .eq('autokick_no_access', true); // CRITICAL: Only autokick if enabled!

    for (const club of clubs || []) {
      const bot = club.telegram_bots;
      if (!bot || bot.status !== 'active') continue;

      // Find violators - people in chat/channel without valid access
      const { data: violators } = await supabase
        .from('telegram_club_members')
        .select('id, telegram_user_id, in_chat, in_channel, access_status, profile_id')
        .eq('club_id', club.id)
        .neq('access_status', 'ok')
        .neq('access_status', 'removed')
        .or('in_chat.eq.true,in_channel.eq.true');

      if (!violators || violators.length === 0) continue;

      console.log(`Club ${club.club_name}: ${violators.length} violators found`);
      
      const botToken = bot.bot_token_encrypted;

      for (const violator of violators) {
        let chatKicked = false;
        let channelKicked = false;

        // Kick from chat if present
        if (club.chat_id && violator.in_chat) {
          const kickResult = await kickUser(botToken, club.chat_id, violator.telegram_user_id);
          chatKicked = kickResult.success;
        }

        // Kick from channel if present
        if (club.channel_id && violator.in_channel) {
          const kickResult = await kickUser(botToken, club.channel_id, violator.telegram_user_id);
          channelKicked = kickResult.success;
        }

        if (chatKicked || channelKicked) {
          results.violators_kicked++;

          // Update member status
          await supabase
            .from('telegram_club_members')
            .update({
              in_chat: chatKicked ? false : violator.in_chat,
              in_channel: channelKicked ? false : violator.in_channel,
              access_status: 'removed',
              updated_at: now,
            })
            .eq('id', violator.id);

          // Log the action
          await supabase.from('telegram_logs').insert({
            user_id: violator.profile_id ? 
              (await supabase.from('profiles').select('user_id').eq('id', violator.profile_id).single()).data?.user_id 
              : null,
            club_id: club.id,
            action: 'AUTO_KICK_VIOLATOR',
            status: 'ok',
            meta: {
              telegram_user_id: violator.telegram_user_id,
              chat_kicked: chatKicked,
              channel_kicked: channelKicked,
            },
          });
        }
      }
    }

    console.log('Expired access and violator check completed:', results);

    return new Response(JSON.stringify({ 
      success: true,
      ...results,
      checked_at: now,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Check expired error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
