import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting expired access check...');

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

    // 2. Check club members without linked profiles (violators)
    const { data: clubs } = await supabase
      .from('telegram_clubs')
      .select('id, club_name')
      .eq('is_active', true);

    let violatorsKicked = 0;

    for (const club of clubs || []) {
      const { data: violators } = await supabase
        .from('telegram_club_members')
        .select('id, telegram_user_id')
        .eq('club_id', club.id)
        .is('profile_id', null)
        .eq('access_status', 'violator');

      if (violators && violators.length > 0) {
        console.log(`Club ${club.club_name}: ${violators.length} violators found`);
        
        try {
          const kickResult = await supabase.functions.invoke('telegram-club-members', {
            body: {
              action: 'kick',
              club_id: club.id,
              member_ids: violators.map(v => v.id),
            },
          });

          if (!kickResult.error) {
            violatorsKicked += kickResult.data?.kicked_count || 0;
          }
        } catch (err) {
          console.error(`Error kicking violators from club ${club.id}:`, err);
        }
      }
    }

    console.log('Expired access check completed:', results, 'Violators kicked:', violatorsKicked);

    return new Response(JSON.stringify({ 
      success: true,
      ...results,
      violators_kicked: violatorsKicked,
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