// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCommercialAccessBatch } from '../_shared/accessValidation.ts';

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
    const BATCH_SIZE = 25;
    // P3: cursor-based batching — process limited slice per invocation
    const BATCH_LIMIT = Number(Deno.env.get('TELEGRAM_CRON_BATCH_LIMIT') ?? '200');

    for (const club of clubs || []) {
      const clubStartedAt = Date.now();
      const bot = club.telegram_bots;
      if (!bot || bot.status !== 'active') {
        console.log(`Skipping club ${club.id} - bot inactive`);
        continue;
      }

      const botToken = bot.bot_token_encrypted;
      const autokick = club.autokick_no_access ?? false;

      console.log(`Processing club: ${club.club_name} (autokick: ${autokick})`);

      // P3: pick the stalest slice — last_telegram_check_at ASC NULLS FIRST, id ASC
      const { data: members } = await supabase
        .from('telegram_club_members')
        .select('*, profiles(*)')
        .eq('club_id', club.id)
        .not('profile_id', 'is', null)
        .order('last_telegram_check_at', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .limit(BATCH_LIMIT);

      // Count remaining candidates eligible for next batch (older than 24h or never checked)
      const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: eligibleCount } = await supabase
        .from('telegram_club_members')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', club.id)
        .not('profile_id', 'is', null)
        .or(`last_telegram_check_at.is.null,last_telegram_check_at.lt.${cutoffIso}`);

      if (!members?.length) {
        console.log(`No linked members in club ${club.id}`);
        continue;
      }

      // PATCH 1: Collect all user_ids and batch-check access via shared validator
      const userIds = members
        .map((m: any) => m.profiles?.user_id)
        .filter((uid: string | undefined): uid is string => !!uid);

      // COMMERCIAL-ONLY (2026-05-22): cron-sync принимает решения на kick по коммерческому праву.
      const accessMap = userIds.length > 0
        ? await hasCommercialAccessBatch(supabase, userIds, club.id)
        : new Map();

      let checkedCount = 0;
      let kickedCount = 0;
      let guardSkipCount = 0;
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
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            const chatStatus = chatResult?.status;
            const isAdminOrCreator = chatStatus === 'administrator' || chatStatus === 'creator';

            // ADMIN INVARIANT: if Telegram says administrator/creator, in_chat MUST be true
            // This prevents the contradiction where chat_status=administrator but in_chat=false
            const inChat = isAdminOrCreator ? true : (chatResult?.isMember ?? null);
            const inChannel = inChat;

            // Anomaly detection: log if admin status contradicts isMember
            if (isAdminOrCreator && chatResult && !chatResult.isMember) {
              console.warn(`ANOMALY: user ${member.telegram_user_id} has chat_status=${chatStatus} but isMember=false — forcing in_chat=true`);
              await supabase.from('audit_logs').insert({
                action: 'telegram.admin_invariant.anomaly',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'telegram-cron-sync',
                meta: {
                  tg_user_id: member.telegram_user_id,
                  club_id: club.id,
                  chat_status: chatStatus,
                  is_member: chatResult.isMember,
                  forced_in_chat: true,
                },
              });
            }

            // Update member record
            await supabase.from('telegram_club_members').update({
              in_chat: inChat,
              in_channel: inChannel,
              last_telegram_check_at: new Date().toISOString(),
              last_verified_at: new Date().toISOString(),
              last_telegram_check_result: { chat: chatResult, channel: 'derived_from_chat' },
              // ADMIN GUARD: if admin/creator, never set access_status to 'removed'
              ...(isAdminOrCreator && member.access_status === 'removed' ? { access_status: 'ok' } : {}),
              updated_at: new Date().toISOString(),
            }).eq('id', member.id);

            // ── pending → active transition ──────────────────────────────
            // If Telegram confirms user is physically in chat AND their
            // telegram_access state is still 'pending', promote to 'active'.
            const userId = member.profiles?.user_id;
            if (inChat && userId) {
              const { data: pendingAccess } = await supabase
                .from('telegram_access')
                .select('id, state_chat, state_channel')
                .eq('user_id', userId)
                .eq('club_id', club.id)
                .eq('state_chat', 'pending')
                .maybeSingle();

              if (pendingAccess) {
                const nowIso = new Date().toISOString();
                await supabase.from('telegram_access')
                  .update({
                    state_chat: 'active',
                    state_channel: 'active',
                    last_sync_at: nowIso,
                  })
                  .eq('id', pendingAccess.id);

                await supabase.from('audit_logs').insert({
                  action: 'telegram.pending_to_active',
                  actor_type: 'system',
                  actor_user_id: null,
                  actor_label: 'telegram-cron-sync',
                  target_user_id: userId,
                  meta: {
                    club_id: club.id,
                    telegram_access_id: pendingAccess.id,
                    tg_user_id: member.telegram_user_id,
                    chat_status: chatStatus,
                  },
                });
                console.log(`PENDING→ACTIVE: user ${member.telegram_user_id} in club ${club.id}`);
              }
            }
            // ── end pending → active ─────────────────────────────────────

            checkedCount++;

            // ADMIN GUARD: skip autokick for administrator/creator — Telegram won't allow ban anyway
            if (isAdminOrCreator) {
              console.log(`ADMIN_PROTECTED: user ${member.telegram_user_id} is ${chatStatus} — skipping autokick`);
              guardSkipCount++;

              await supabase.from('audit_logs').insert({
                action: 'telegram.autokick.admin_protected',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'telegram-cron-sync',
                meta: {
                  tg_user_id: member.telegram_user_id,
                  club_id: club.id,
                  chat_status: chatStatus,
                },
              });
              continue;
            }

            // COMMERCIAL-ONLY (2026-05-22): результат из hasCommercialAccessBatch.
            const accessResult = userId ? accessMap.get(userId) : undefined;
            const hasAccess = accessResult?.valid ?? false;

            if (autokick && inChat && !hasAccess) {
              // STOP-guard: if access check returned undefined/error, don't kick
              if (!accessResult) {
                console.log(`GUARD_SKIP: user ${member.telegram_user_id} - access check returned undefined, skipping kick`);
                guardSkipCount++;

                await supabase.from('audit_logs').insert({
                  action: 'telegram.autokick.guard_skip',
                  actor_type: 'system',
                  actor_user_id: null,
                  actor_label: 'telegram-cron-sync',
                  meta: {
                    reason: 'access_check_undefined',
                    tg_user_id: member.telegram_user_id,
                    club_id: club.id,
                  },
                });
                continue;
              }

              console.log(`Autokicking user ${member.telegram_user_id} - no valid access (source check complete)`);

              await supabase.from('audit_logs').insert({
                action: 'telegram.autokick.attempt',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'telegram-cron-sync',
                meta: {
                  reason: 'no_valid_access',
                  access_valid: false,
                  tg_user_id: member.telegram_user_id,
                  club_id: club.id,
                },
              });

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

              await logAudit(supabase, {
                club_id: club.id,
                user_id: userId,
                telegram_user_id: member.telegram_user_id,
                event_type: 'AUTOKICK',
                actor_type: 'cron',
                reason: 'No active access - removed by cron (shared validator)',
                telegram_chat_result: chatKickResult,
                telegram_channel_result: channelKickResult,
              });

              kickedCount++;
            } else if (autokick && inChat && hasAccess) {
              // User has valid access and is in chat - ensure access_status is ok
              if (member.access_status !== 'ok') {
                await supabase.from('telegram_club_members').update({
                  access_status: 'ok',
                  updated_at: new Date().toISOString(),
                }).eq('id', member.id);
              }
            }
          } catch (error) {
            console.error(`Error processing member ${member.telegram_user_id}:`, error);
            errorCount++;
          }
        }

        // Delay between batches
        if (i + BATCH_SIZE < members.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const durationMs = Date.now() - clubStartedAt;
      const processedIds = members.map((m: any) => m.id);
      const lastProcessedMemberId = processedIds[processedIds.length - 1] ?? null;
      const remainingEstimate = Math.max((eligibleCount ?? 0) - checkedCount, 0);
      const isPartial = remainingEstimate > 0;

      // P2: write-back sync timestamps
      // last_status_check_at — always; last_members_sync_at — only when full pass (no remaining)
      const clubUpdate: Record<string, unknown> = {
        last_status_check_at: new Date().toISOString(),
      };
      if (!isPartial) {
        clubUpdate.last_members_sync_at = new Date().toISOString();
      }
      await supabase.from('telegram_clubs').update(clubUpdate).eq('id', club.id);

      // Legacy audit (existing dashboards depend on it)
      await logAudit(supabase, {
        club_id: club.id,
        event_type: 'CRON_SYNC',
        actor_type: 'cron',
        meta: { checked_count: checkedCount, kicked_count: kickedCount, guard_skip_count: guardSkipCount, error_count: errorCount, batch_limit: BATCH_LIMIT, is_partial: isPartial },
      });

      // P3: structured batch audit
      await supabase.from('audit_logs').insert({
        action: 'telegram.cron_sync.batch',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'telegram-cron-sync',
        meta: {
          club_id: club.id,
          club_name: club.club_name,
          processed: members.length,
          updated: checkedCount,
          kicked: kickedCount,
          guard_skips: guardSkipCount,
          errors: errorCount,
          duration_ms: durationMs,
          batch_limit: BATCH_LIMIT,
          is_partial: isPartial,
          remaining_estimate: remainingEstimate,
          last_processed_member_id: lastProcessedMemberId,
          eligible_total: eligibleCount ?? null,
        },
      });

      results.push({
        club_id: club.id,
        club_name: club.club_name,
        processed: members.length,
        checked: checkedCount,
        kicked: kickedCount,
        guard_skips: guardSkipCount,
        errors: errorCount,
        batch_limit: BATCH_LIMIT,
        is_partial: isPartial,
        remaining_estimate: remainingEstimate,
        duration_ms: durationMs,
        last_processed_member_id: lastProcessedMemberId,
      });

      console.log(`Club ${club.club_name}: processed=${members.length} checked=${checkedCount} kicked=${kickedCount} guard_skips=${guardSkipCount} errors=${errorCount} partial=${isPartial} remaining=${remainingEstimate} duration_ms=${durationMs}`);
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
