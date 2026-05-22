import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCommercialAccess } from '../_shared/accessValidation.ts';
import { executeRevoke, type RevokeContext } from '../_shared/access-revoker.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const jobRunId = crypto.randomUUID();

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
      .or('state_chat.eq.active,state_channel.eq.active,state_chat.eq.pending,state_channel.eq.pending')
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
      
      // COMMERCIAL-ONLY (2026-05-22): не пропускаем revoke по stale telegram_access projection.
      const accessCheck = await hasCommercialAccess(supabase, access.user_id, access.club_id);
      
      if (accessCheck.valid) {
        console.log(`User ${access.user_id} has valid access via ${accessCheck.source}, skipping. Reason: skipped_valid_access`);
        // Update access record to match real expiry
        if (accessCheck.endAt) {
          await supabase
            .from('telegram_access')
            .update({ 
              active_until: accessCheck.endAt,
              last_sync_at: now,
            })
            .eq('id', access.id);
        }

        // Phase 1 Ledger: skip — decision already made outside, write directly
        try {
          const skipEntry: LedgerEntry = {
            source_event_type: 'cron',
            source_event_key: `cron-expire:${jobRunId}:${access.id}`,
            source_subject_type: 'cron_job',
            source_subject_ref: jobRunId,
            action_type: 'skip',
            reason_code: 'already_active',
            target_type: 'club',
            target_key: `${access.user_id}:${access.club_id}`,
            target_ref: access.club_id,
            user_id: access.user_id,
            status: 'skipped',
            result: {
              skip_reason: 'valid_access_detected',
              access_source: accessCheck.source,
              access_end_at: accessCheck.endAt,
              reconcile_basis: 'access_expired_but_valid',
            },
          };
          await writeLedgerEntry(supabase, skipEntry);
        } catch (ledgerErr) {
          console.error('[telegram-check-expired] Ledger skip error (non-blocking):', ledgerErr);
        }

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

        // Write audit_logs with system actor proof
        try {
          const { resolveEffectiveClubAccess } = await import('../_shared/resolve-effective-access.ts');
          const accessSnapshot = await resolveEffectiveClubAccess(supabase, access.user_id, access.club_id);
          
          await supabase.from('audit_logs').insert({
            action: 'telegram.access_expired_revoke',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'telegram-check-expired',
            target_user_id: access.user_id,
            meta: {
              reason_code: 'subscription_expired',
              reason_text: 'Срок доступа истёк',
              club_id: access.club_id,
              access_snapshot: {
                active_until: access.active_until,
                effective_end_at: accessSnapshot.effectiveEndAt?.toISOString() || null,
                is_unlimited: accessSnapshot.isUnlimited,
                sources_count: accessSnapshot.allSources.length,
              },
            },
          });
        } catch (auditErr) {
          console.error('[telegram-check-expired] Audit log error (non-blocking):', auditErr);
        }

        // Phase 1 Ledger: revoke via executeRevoke
        try {
          const revokeCtx: RevokeContext = {
            userId: access.user_id,
            targetType: 'club',
            targetKey: `${access.user_id}:${access.club_id}`,
            targetRef: access.club_id,
            reasonCode: 'cron_cleanup',
            reconcileBasis: 'access_expired',
            sourceEventType: 'cron',
            sourceEventKey: `cron-expire:${jobRunId}:${access.id}`,
            sourceSubjectType: 'cron_job',
            sourceSubjectRef: jobRunId,
            clubId: access.club_id,
          };
          const revokeResult = await executeRevoke(supabase, revokeCtx);
          console.log(`[telegram-check-expired] Ledger revoke: revoked=${revokeResult.revoked}, id=${revokeResult.ledgerId}`);
        } catch (ledgerErr) {
          console.error('[telegram-check-expired] Ledger revoke error (non-blocking):', ledgerErr);
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
        .select('id, telegram_user_id, in_chat, in_channel, access_status, profile_id, last_telegram_check_result')
        .eq('club_id', club.id)
        .neq('access_status', 'ok')
        .neq('access_status', 'removed')
        .or('in_chat.eq.true,in_channel.eq.true');

      if (!violators || violators.length === 0) continue;

      console.log(`Club ${club.club_name}: ${violators.length} violator candidates found`);
      
      const botToken = bot.bot_token_encrypted;

      // PATCH 2: Collect profile_ids to batch-resolve user_ids for access check
      const profileIds = violators
        .map((v: any) => v.profile_id)
        .filter((pid: string | null): pid is string => !!pid);
      
      // Batch resolve profile_id -> user_id
      const profileUserMap = new Map<string, string>();
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, user_id')
          .in('id', profileIds);
        for (const p of profiles || []) {
          profileUserMap.set(p.id, p.user_id);
        }
      }

      // Batch check access for all candidate violators
      const userIds = [...new Set(Array.from(profileUserMap.values()))];
      
      // Import-free: inline batch check using subscriptions_v2
      const accessValidMap = new Map<string, boolean>();
      if (userIds.length > 0) {
        const { data: activeSubs } = await supabase
          .from('subscriptions_v2')
          .select('user_id, access_end_at')
          .in('user_id', userIds)
          .in('status', ['active', 'trial', 'past_due'])
          .or(`access_end_at.is.null,access_end_at.gt.${now}`);
        
        for (const sub of activeSubs || []) {
          accessValidMap.set(sub.user_id, true);
        }

        // Also check entitlements
        const remainingIds = userIds.filter(uid => !accessValidMap.get(uid));
        if (remainingIds.length > 0) {
          const { data: activeEnts } = await supabase
            .from('entitlements')
            .select('user_id')
            .in('user_id', remainingIds)
            .eq('status', 'active')
            .or(`expires_at.is.null,expires_at.gt.${now}`);
          
          for (const ent of activeEnts || []) {
            accessValidMap.set(ent.user_id, true);
          }
        }

        // Also check manual access
        const stillRemaining = userIds.filter(uid => !accessValidMap.get(uid));
        if (stillRemaining.length > 0) {
          const { data: manualList } = await supabase
            .from('telegram_manual_access')
            .select('user_id')
            .in('user_id', stillRemaining)
            .eq('club_id', club.id)
            .eq('is_active', true)
            .or(`valid_until.is.null,valid_until.gt.${now}`);
          
          for (const ma of manualList || []) {
            accessValidMap.set(ma.user_id, true);
          }
        }
      }

      for (const violator of violators) {
        // ADMIN GUARD: check last_telegram_check_result for admin/creator status
        const checkResult = violator.last_telegram_check_result as Record<string, any> | null;
        const vChatStatus = checkResult?.chat?.status;
        const vChannelStatus = checkResult?.channel?.status;
        const isViolatorAdmin = ['administrator', 'creator'].includes(vChatStatus) || ['administrator', 'creator'].includes(vChannelStatus);

        if (isViolatorAdmin) {
          console.log(`ADMIN_PROTECTED: violator ${violator.telegram_user_id} is ${vChatStatus || vChannelStatus} — skipping kick`);
          await supabase.from('audit_logs').insert({
            action: 'telegram.autokick.admin_protected',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'telegram-check-expired',
            meta: {
              tg_user_id: violator.telegram_user_id,
              club_id: club.id,
              chat_status: vChatStatus,
              channel_status: vChannelStatus,
            },
          });
          continue;
        }

        const userId = violator.profile_id ? profileUserMap.get(violator.profile_id) : null;
        const hasValidAccessResult = userId ? (accessValidMap.get(userId) ?? false) : false;

        // PATCH TG-REVOKE-FALSE-REGRANT: If user has valid access, fix status — with reason log
        if (hasValidAccessResult) {
          console.log(`GUARD_SKIP violator ${violator.telegram_user_id} - has valid access, fixing status. Reason: skipped_valid_access`);
          
          await supabase
            .from('telegram_club_members')
            .update({ access_status: 'ok', updated_at: now })
            .eq('id', violator.id);

          await supabase.from('audit_logs').insert({
            action: 'telegram.autokick.guard_skip',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'telegram-check-expired',
            meta: {
              reason: 'valid_access_detected',
              tg_user_id: violator.telegram_user_id,
              club_id: club.id,
            },
          });

          results.violators_kicked--; // Not actually kicked
          continue;
        }

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

          // Audit log for actual kick
          await supabase.from('audit_logs').insert({
            action: 'telegram.autokick.attempt',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'telegram-check-expired',
            meta: {
              reason: 'no_valid_access',
              access_valid: false,
              tg_user_id: violator.telegram_user_id,
              club_id: club.id,
            },
          });

          // Log the action
          await supabase.from('telegram_logs').insert({
            user_id: userId || null,
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
