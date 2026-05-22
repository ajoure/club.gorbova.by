/**
 * PATCH P0.9.5: Telegram Kick Violators Cron
 * 
 * CRITICAL FIX: Now checks subscriptions_v2 BEFORE kicking
 * Uses hasValidAccessBatch for bulk checks (no N+1)
 * 
 * STOP-guards:
 * - batch size: max 50 per run
 * - hard cap: 200 total
 * - rate-limit detection: stop and log retry_after
 * - runtime cap: 80 seconds
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCommercialAccessBatch, type AccessCheckResult } from '../_shared/accessValidation.ts';
import { executeRevoke, type RevokeContext } from '../_shared/access-revoker.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// STOP-guards configuration (PATCH P0.9.5)
const BATCH_SIZE = 50;
const HARD_CAP = 200;
const RUNTIME_LIMIT_MS = 80000; // 80 seconds

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
  retryAfter?: number;
}> {
  try {
    const result = await telegramRequest(botToken, 'getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });

    // Rate limit detection
    if (result.error_code === 429 && result.parameters?.retry_after) {
      return { isMember: false, status: 'rate_limited', retryAfter: result.parameters.retry_after };
    }

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

// CRITICAL: Ban user permanently (no automatic unban) to prevent rejoin via old links
async function kickUser(botToken: string, chatId: number, userId: number): Promise<{ 
  success: boolean; 
  error?: string;
  retryAfter?: number;
}> {
  try {
    console.log(`Banning user ${userId} from chat ${chatId} (permanent, no unban)`);
    
    const banResult = await telegramRequest(botToken, 'banChatMember', {
      chat_id: chatId,
      user_id: userId,
      revoke_messages: false,
      // Ban for 366 days to prevent rejoin via old invite links
      until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
    });
    
    // Rate limit detection
    if (banResult.error_code === 429 && banResult.parameters?.retry_after) {
      return { success: false, retryAfter: banResult.parameters.retry_after };
    }
    
    if (!banResult.ok) {
      // Still try preventive ban even if not a member
      if (banResult.description?.includes('user is not a member') || 
          banResult.description?.includes('PARTICIPANT_NOT_EXISTS') ||
          banResult.description?.includes('USER_NOT_PARTICIPANT')) {
        await telegramRequest(botToken, 'banChatMember', {
          chat_id: chatId,
          user_id: userId,
          until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
        });
        return { success: true };
      }
      return { success: false, error: banResult.description || 'Failed to ban user' };
    }

    // DO NOT UNBAN - this prevents rejoin via old invite links
    // User will be unbanned when access is granted again via telegram-grant-access

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

  const startTime = Date.now();
  console.log('=== Telegram Kick Violators Cron Started (PATCH P0.9.5) ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const jobRunId = crypto.randomUUID();

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
      skipped_with_access: number;
      errors: number;
    }[] = [];

    let totalProcessed = 0;
    let rateLimitHit = false;
    let rateLimitRetryAfter: number | undefined;

    for (const club of clubs || []) {
      // STOP-guard: runtime limit
      if (Date.now() - startTime > RUNTIME_LIMIT_MS) {
        console.log(`STOP-guard: Runtime limit reached (${RUNTIME_LIMIT_MS}ms), stopping`);
        break;
      }

      // STOP-guard: hard cap
      if (totalProcessed >= HARD_CAP) {
        console.log(`STOP-guard: Hard cap reached (${HARD_CAP}), stopping`);
        break;
      }

      // STOP-guard: rate limit
      if (rateLimitHit) {
        console.log(`STOP-guard: Rate limit hit, stopping. Retry after: ${rateLimitRetryAfter}s`);
        break;
      }

      const botToken = club.telegram_bots?.bot_token_encrypted;
      if (!botToken) {
        console.log(`Club ${club.club_name}: No bot token, skipping`);
        continue;
      }

      console.log(`Processing club: ${club.club_name}`);

      // PATCH C: Find violators in two groups:
      // Group 1: access_status != 'ok' AND in_chat/in_channel = true (existing logic)
      // Group 2: access_status = 'ok' but will be re-validated by hasValidAccessBatch below
      // Both groups are loaded together and validated via hasValidAccessBatch.
      const { data: violators, error: violatorsError } = await supabase
        .from('telegram_club_members')
        .select('*')
        .eq('club_id', club.id)
        .or('in_chat.eq.true,in_channel.eq.true')
        .limit(BATCH_SIZE);


      if (violatorsError) {
        console.error(`Failed to fetch violators for club ${club.club_name}:`, violatorsError);
        continue;
      }

      console.log(`Found ${violators?.length || 0} potential violators in ${club.club_name}`);

      // PATCH P0.9.5: Bulk load profile_id -> user_id mapping (no N+1!)
      const profileIds = (violators || [])
        .filter(v => v.profile_id)
        .map(v => v.profile_id);
      
      const profileToUserIdMap = new Map<string, string>();
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, user_id')
          .in('id', profileIds);
        
        for (const p of profiles || []) {
          if (p.user_id) {
            profileToUserIdMap.set(p.id, p.user_id);
          }
        }
      }
      console.log(`PATCH P0.9.5: Loaded ${profileToUserIdMap.size} profile->user_id mappings`);

      // PATCH P0.9.5: Bulk check access for all user_ids using hasValidAccessBatch
      const userIdsToCheck = [...new Set(Array.from(profileToUserIdMap.values()))];
      let accessResults = new Map<string, AccessCheckResult>();
      
      if (userIdsToCheck.length > 0) {
        accessResults = await hasValidAccessBatch(supabase, userIdsToCheck, club.id);
        console.log(`PATCH P0.9.5: Checked access for ${userIdsToCheck.length} users`);
      }

      let kickedCount = 0;
      let errorCount = 0;
      let checkedCount = 0;
      let skippedWithAccess = 0;

      for (const member of violators || []) {
        // STOP-guards
        if (Date.now() - startTime > RUNTIME_LIMIT_MS) break;
        if (totalProcessed >= HARD_CAP) break;
        if (rateLimitHit) break;

        checkedCount++;
        totalProcessed++;

        // PATCH C: Validate access via hasValidAccessBatch for ALL members in chat/channel.
        // This catches the case where access_status='ok' but real access was revoked.
        const userId = member.profile_id ? profileToUserIdMap.get(member.profile_id) : undefined;
        const accessCheck = userId ? accessResults.get(userId) : undefined;

        if (accessCheck?.valid) {
          // SKIP KICK: User has valid access confirmed by source of truth
          console.log(`SKIP kick: user ${member.telegram_user_id} has valid access via ${accessCheck.source} until ${accessCheck.endAt}`);
          skippedWithAccess++;

          // Ensure access_status='ok' reflects real state
          if (member.access_status !== 'ok') {
            await supabase
              .from('telegram_club_members')
              .update({ access_status: 'ok', updated_at: new Date().toISOString() })
              .eq('id', member.id);
          }

          await logAudit(supabase, {
            club_id: club.id,
            event_type: 'AUTO_GUARD_SKIP',
            actor_type: 'cron',
            telegram_user_id: member.telegram_user_id,
            user_id: userId,
            reason: 'active_subscription_guard',
            meta: {
              access_source: accessCheck.source,
              access_end_at: accessCheck.endAt,
              subscription_id: accessCheck.subscriptionId,
              entitlement_id: accessCheck.entitlementId,
              previous_access_status: member.access_status,
            },
          });

          // Phase 1 Ledger: skip — valid access detected
          try {
            const skipEntry: LedgerEntry = {
              source_event_type: 'cron',
              source_event_key: `cron-kick:${jobRunId}:${member.id}`,
              source_subject_type: 'cron_job',
              source_subject_ref: jobRunId,
              action_type: 'skip',
              reason_code: 'already_active',
              target_type: 'club',
              target_key: `${userId || member.telegram_user_id}:${club.id}`,
              target_ref: club.id,
              user_id: userId || null,
              status: 'skipped',
              result: {
                skip_reason: 'valid_access_detected',
                access_source: accessCheck.source,
                access_end_at: accessCheck.endAt,
                reconcile_basis: 'no_valid_access',
              },
            };
            await writeLedgerEntry(supabase, skipEntry);
          } catch (ledgerErr) {
            console.error('[telegram-kick-violators] Ledger skip error (non-blocking):', ledgerErr);
          }

          continue; // Skip to next member
        }

        // ADMIN GUARD: check last_telegram_check_result for admin/creator status
        const memberCheckResult = member.last_telegram_check_result as Record<string, any> | null;
        const mChatStatus = memberCheckResult?.chat?.status;
        const mChannelStatus = memberCheckResult?.channel?.status;
        const isMemberAdmin = ['administrator', 'creator'].includes(mChatStatus) || ['administrator', 'creator'].includes(mChannelStatus);

        if (isMemberAdmin) {
          console.log(`ADMIN_PROTECTED: member ${member.telegram_user_id} is ${mChatStatus || mChannelStatus} — skipping kick`);
          skippedWithAccess++;
          await logAudit(supabase, {
            club_id: club.id,
            event_type: 'KICK_SKIP_ADMIN_PROTECTED',
            actor_type: 'cron',
            telegram_user_id: member.telegram_user_id,
            meta: { chat_status: mChatStatus, channel_status: mChannelStatus },
          });
          continue;
        }

        // GUARD B (PATCH-KOROLYOVA): Grace period for fresh provider_managed subscriptions.
        // Skip kick if a provider_managed subscription was created < 48h ago — bePaid sync may not have updated dates yet.
        if (userId) {
          const PROVIDER_GRACE_MS = 48 * 60 * 60 * 1000;
          const graceThreshold = new Date(Date.now() - PROVIDER_GRACE_MS).toISOString();

          const { data: freshProviderSubs } = await supabase
            .from('subscriptions_v2')
            .select('id, created_at, billing_type')
            .eq('user_id', userId)
            .eq('billing_type', 'provider_managed')
            .eq('status', 'active')
            .gte('created_at', graceThreshold)
            .limit(1);

          if (freshProviderSubs && freshProviderSubs.length > 0) {
            console.log(`GUARD B: Skipping kick for user ${member.telegram_user_id} — fresh provider_managed subscription ${freshProviderSubs[0].id} created at ${freshProviderSubs[0].created_at} (within 48h grace)`);
            skippedWithAccess++;

            await logAudit(supabase, {
              club_id: club.id,
              event_type: 'KICK_SKIP_PROVIDER_GRACE',
              actor_type: 'cron',
              telegram_user_id: member.telegram_user_id,
              user_id: userId,
              reason: 'provider_managed_grace_48h',
              meta: {
                subscription_id: freshProviderSubs[0].id,
                subscription_created_at: freshProviderSubs[0].created_at,
                guard: 'GUARD_B_KOROLYOVA',
              },
            });

            continue; // Skip to next member
          }
        }

        // No valid access confirmed — proceed to kick even if access_status was 'ok'
        if (member.access_status === 'ok') {
          console.log(`PATCH C: user ${member.telegram_user_id} had access_status='ok' but hasValidAccessBatch returned invalid — proceeding to kick`);
        }

        // User does NOT have valid access - proceed with kick
        let kickedFromChat = false;
        let kickedFromChannel = false;

        // Verify and kick from chat if present
        if (club.chat_id && member.in_chat) {
          // Double-check membership before kicking
          const chatCheck = await checkMembership(botToken, club.chat_id, member.telegram_user_id);
          
          if (chatCheck.retryAfter) {
            rateLimitHit = true;
            rateLimitRetryAfter = chatCheck.retryAfter;
            console.log(`Rate limit hit on chat check: retry after ${chatCheck.retryAfter}s`);
            break;
          }
          
          if (chatCheck.isMember) {
            console.log(`Kicking violator ${member.telegram_user_id} from chat ${club.chat_id}`);
            const kickResult = await kickUser(botToken, club.chat_id, member.telegram_user_id);
            
            if (kickResult.retryAfter) {
              rateLimitHit = true;
              rateLimitRetryAfter = kickResult.retryAfter;
              console.log(`Rate limit hit on kick: retry after ${kickResult.retryAfter}s`);
              break;
            }
            
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
        if (club.channel_id && member.in_channel && !rateLimitHit) {
          const channelCheck = await checkMembership(botToken, club.channel_id, member.telegram_user_id);
          
          if (channelCheck.retryAfter) {
            rateLimitHit = true;
            rateLimitRetryAfter = channelCheck.retryAfter;
            break;
          }
          
          if (channelCheck.isMember) {
            console.log(`Kicking violator ${member.telegram_user_id} from channel ${club.channel_id}`);
            const kickResult = await kickUser(botToken, club.channel_id, member.telegram_user_id);
            
            if (kickResult.retryAfter) {
              rateLimitHit = true;
              rateLimitRetryAfter = kickResult.retryAfter;
              break;
            }
            
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

          // Phase 1 Ledger: revoke for kicked violator
          try {
            const revokeCtx: RevokeContext = {
              userId: userId || `tg:${member.telegram_user_id}`,
              targetType: 'club',
              targetKey: `${userId || member.telegram_user_id}:${club.id}`,
              targetRef: club.id,
              reasonCode: 'violation_kick',
              reconcileBasis: 'no_valid_access',
              sourceEventType: 'cron',
              sourceEventKey: `cron-kick:${jobRunId}:${member.id}`,
              sourceSubjectType: 'cron_job',
              sourceSubjectRef: jobRunId,
              clubId: club.id,
            };
            const revokeResult = await executeRevoke(supabase, revokeCtx);
            console.log(`[telegram-kick-violators] Ledger revoke: revoked=${revokeResult.revoked}, member=${member.id}`);
          } catch (ledgerErr) {
            console.error('[telegram-kick-violators] Ledger error (non-blocking):', ledgerErr);
          }

          // PATCH P0.9.5: Also log to telegram_logs for unified history
          await supabase.from('telegram_logs').insert({
            action: 'cron_autokick',
            club_id: club.id,
            user_id: member.profile_id,
            telegram_user_id: member.telegram_user_id,
            status: 'success',
            meta: {
              kicked_from_chat: kickedFromChat,
              kicked_from_channel: kickedFromChannel,
              access_status_was: member.access_status,
            },
          });

          // DM to kicked user (non-fatal: failure does not undo kick)
          try {
            const dmText = `❌ Ваш доступ к ${club.club_name || 'клубу'} завершён.\n\nПричина: срок доступа истёк.\n\nВы можете вернуться в любой момент, оформив подписку 👇`;
            const dmKeyboard = {
              inline_keyboard: [[{ text: '💳 Продлить подписку', url: 'https://gorbova.lovable.app/pricing' }]],
            };
            const dmBody: Record<string, unknown> = {
              chat_id: member.telegram_user_id,
              text: dmText,
              parse_mode: 'HTML',
              reply_markup: dmKeyboard,
            };
            const dmResp = await telegramRequest(botToken, 'sendMessage', dmBody);
            if (!dmResp?.ok) {
              console.log(`[kick-violators] DM failed for ${member.telegram_user_id}: ${dmResp?.description || 'unknown'}`);
            }
          } catch (dmErr) {
            console.log(`[kick-violators] DM error for ${member.telegram_user_id} (non-fatal):`, dmErr);
          }
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
            skipped_with_access: skippedWithAccess,
            errors: errorCount,
            rate_limit_hit: rateLimitHit,
          },
        });
      }

      results.push({
        club_id: club.id,
        club_name: club.club_name,
        checked: checkedCount,
        kicked: kickedCount,
        skipped_with_access: skippedWithAccess,
        errors: errorCount,
      });

      console.log(`Club ${club.club_name}: checked=${checkedCount}, kicked=${kickedCount}, skipped_with_access=${skippedWithAccess}, errors=${errorCount}`);
    }

    const totalKicked = results.reduce((sum, r) => sum + r.kicked, 0);
    const totalChecked = results.reduce((sum, r) => sum + r.checked, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped_with_access, 0);
    const runtimeMs = Date.now() - startTime;

    console.log(`=== Cron completed: ${totalChecked} checked, ${totalKicked} kicked, ${totalSkipped} skipped (valid access), runtime=${runtimeMs}ms ===`);

    return new Response(JSON.stringify({
      success: true,
      total_checked: totalChecked,
      total_kicked: totalKicked,
      total_skipped_with_access: totalSkipped,
      runtime_ms: runtimeMs,
      rate_limit_hit: rateLimitHit,
      rate_limit_retry_after: rateLimitRetryAfter,
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
