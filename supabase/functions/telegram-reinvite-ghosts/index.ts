import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasValidAccessBatch } from '../_shared/accessValidation.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';
import { greetPrefix } from '../_shared/recipient-name.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BATCH = 20;
const RUNTIME_CAP_MS = 80000;
const ERROR_THRESHOLD = 0.2; // 20%
const THROTTLE_MS = 500;
const MAX_REINVITES_24H = 3;

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const result = await response.json();
  if (!result.ok && result.error_code === 429) {
    return { ...result, rate_limited: true, retry_after: result.parameters?.retry_after || 60 };
  }
  return result;
}

function extractInviteCode(link: string): string {
  const plusMatch = link.match(/\+([A-Za-z0-9_-]+)$/);
  if (plusMatch) return plusMatch[1];
  const joinMatch = link.match(/joinchat\/([A-Za-z0-9_-]+)$/);
  if (joinMatch) return joinMatch[1];
  return link.split('/').pop() || link;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cronSecret = Deno.env.get('CRON_SECRET');

    // Auth: service role or cron secret
    const authHeader = req.headers.get('Authorization');
    const xCronSecret = req.headers.get('x-cron-secret');
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    const isCron = cronSecret && xCronSecret === cronSecret;

    if (!isServiceRole && !isCron) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active clubs with bots
    const { data: clubs } = await supabase
      .from('telegram_clubs')
      .select('id, chat_id, channel_id, join_request_mode, club_name, telegram_bots(id, bot_token_encrypted, status)')
      .eq('is_active', true);

    if (!clubs?.length) {
      return new Response(JSON.stringify({ ok: true, message: 'No active clubs', processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalProcessed = 0;
    let totalVerified = 0;
    let totalReinvited = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const club of clubs) {
      if (Date.now() - startTime > RUNTIME_CAP_MS) {
        console.warn('[reinvite-ghosts] Runtime cap reached, stopping');
        break;
      }

      const bot = (club as any).telegram_bots;
      if (!bot || bot.status !== 'active') continue;
      const botToken = bot.bot_token_encrypted;

      // Find ghost candidates: access_status=ok, not in chat/channel, invite sent > 4h ago
      const { data: ghosts } = await supabase
        .from('telegram_club_members')
        .select('id, telegram_user_id, profile_id, in_chat, in_channel, invite_sent_at')
        .eq('club_id', club.id)
        .eq('access_status', 'ok')
        .eq('link_status', 'linked')
        .or('in_chat.eq.false,in_channel.eq.false')
        .not('telegram_user_id', 'is', null)
        .limit(MAX_BATCH * 2); // Get extra to filter

      if (!ghosts?.length) continue;

      // PATCH: Batch check real access for all ghost candidates
      // Resolve profile_id → user_id
      const ghostProfileIds = (ghosts || []).filter(g => g.profile_id).map(g => g.profile_id);
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, user_id')
        .in('id', ghostProfileIds);
      const profileToUserId = new Map((profileRows || []).map((p: { id: string; user_id: string }) => [p.id, p.user_id]));
      const ghostUserIds = [...new Set(
        ghostProfileIds.map(id => profileToUserId.get(id)).filter(Boolean) as string[]
      )];
      const accessMap = ghostUserIds.length > 0
        ? await hasValidAccessBatch(supabase, ghostUserIds, club.id)
        : new Map();

      // Filter: invite_sent_at > 4h ago or null
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const candidates = ghosts.filter(g => 
        !g.invite_sent_at || g.invite_sent_at < fourHoursAgo
      ).slice(0, MAX_BATCH);

      for (const ghost of candidates) {
        if (Date.now() - startTime > RUNTIME_CAP_MS) break;
        if (totalErrors > 0 && totalErrors / (totalProcessed || 1) > ERROR_THRESHOLD) {
          console.warn('[reinvite-ghosts] Error threshold exceeded, stopping');
          break;
        }

        totalProcessed++;

        // PATCH: Guard — check real access before reinvite
        const ghostUserId = profileToUserId.get(ghost.profile_id);
        const accessResult = ghostUserId ? accessMap.get(ghostUserId) : null;
        if (!accessResult?.valid) {
          // No real access → update status to no_access, do NOT reinvite
          console.log(`[reinvite-ghosts] No real access for profile=${ghost.profile_id} tgid=${ghost.telegram_user_id}, setting no_access`);
          await supabase.from('telegram_club_members').update({
            access_status: 'no_access',
            updated_at: new Date().toISOString(),
          }).eq('id', ghost.id);
          totalSkipped++;
          continue;
        }

        // Check reinvite count in last 24h (from telegram_invite_links)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: recentReinvites } = await supabase
          .from('telegram_invite_links')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', club.id)
          .eq('profile_id', ghost.profile_id)
          .gte('sent_at', twentyFourHoursAgo)
          .in('source', ['reinvite', 'cron_reinvite']);

        if ((recentReinvites || 0) >= MAX_REINVITES_24H) {
          totalSkipped++;
          continue;
        }

        // Check MISMATCH count in last 24h
        const { count: mismatchCount } = await supabase
          .from('telegram_invite_links')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', club.id)
          .eq('profile_id', ghost.profile_id)
          .eq('status', 'mismatch')
          .gte('created_at', twentyFourHoursAgo);

        if ((mismatchCount || 0) >= 2) {
          totalSkipped++;
          console.log(`[reinvite-ghosts] Skipping ${ghost.telegram_user_id}: security review (mismatch >= 2)`);
          continue;
        }

        // Step 1: Check if actually in chat via getChatMember
        let alreadyInChat = false;
        let alreadyInChannel = false;

        if (!ghost.in_chat && club.chat_id) {
          const result = await telegramRequest(botToken, 'getChatMember', {
            chat_id: club.chat_id,
            user_id: ghost.telegram_user_id,
          });
          if (result.rate_limited) {
            console.warn(`[reinvite-ghosts] Rate limited, stopping`);
            break;
          }
          if (result.ok && ['member', 'administrator', 'creator'].includes(result.result?.status)) {
            alreadyInChat = true;
          }
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }

        if (!ghost.in_channel && club.channel_id) {
          const result = await telegramRequest(botToken, 'getChatMember', {
            chat_id: club.channel_id,
            user_id: ghost.telegram_user_id,
          });
          if (result.rate_limited) break;
          if (result.ok && ['member', 'administrator', 'creator'].includes(result.result?.status)) {
            alreadyInChannel = true;
          }
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }

        // If already in both, just update DB
        if ((alreadyInChat || ghost.in_chat || !club.chat_id) && 
            (alreadyInChannel || ghost.in_channel || !club.channel_id)) {
          const update: Record<string, unknown> = { updated_at: new Date().toISOString(), last_verified_at: new Date().toISOString() };
          if (alreadyInChat) { update.in_chat = true; update.verified_in_chat_at = new Date().toISOString(); }
          if (alreadyInChannel) { update.in_channel = true; update.verified_in_channel_at = new Date().toISOString(); }
          await supabase.from('telegram_club_members').update(update).eq('id', ghost.id);
          totalVerified++;
          continue;
        }

        // Step 2: Unban if needed, create invite, send DM
        const needsChat = !ghost.in_chat && !alreadyInChat && club.chat_id;
        const needsChannel = !ghost.in_channel && !alreadyInChannel && club.channel_id;

        let chatLink: string | null = null;
        let channelLink: string | null = null;

        if (needsChat) {
          // Unban first
          await telegramRequest(botToken, 'unbanChatMember', {
            chat_id: club.chat_id,
            user_id: ghost.telegram_user_id,
            only_if_banned: false,
          });
          await new Promise(r => setTimeout(r, THROTTLE_MS));

          const joinRequestMode = (club as any).join_request_mode ?? false;
          const inviteParams: Record<string, unknown> = {
            chat_id: club.chat_id,
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 86400,
            name: `Reinvite ghost ${ghost.telegram_user_id}`,
          };
          if (joinRequestMode) {
            inviteParams.creates_join_request = true;
            delete inviteParams.member_limit;
          }

          const result = await telegramRequest(botToken, 'createChatInviteLink', inviteParams);
          if (result.rate_limited) break;
          if (result.ok) {
            chatLink = result.result.invite_link;
          } else {
            totalErrors++;
            continue;
          }
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }

        if (needsChannel) {
          await telegramRequest(botToken, 'unbanChatMember', {
            chat_id: club.channel_id,
            user_id: ghost.telegram_user_id,
            only_if_banned: false,
          });
          await new Promise(r => setTimeout(r, THROTTLE_MS));

          const joinRequestMode = (club as any).join_request_mode ?? false;
          const inviteParams: Record<string, unknown> = {
            chat_id: club.channel_id,
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 86400,
            name: `Reinvite ghost ${ghost.telegram_user_id}`,
          };
          if (joinRequestMode) {
            inviteParams.creates_join_request = true;
            delete inviteParams.member_limit;
          }

          const result = await telegramRequest(botToken, 'createChatInviteLink', inviteParams);
          if (result.rate_limited) break;
          if (result.ok) {
            channelLink = result.result.invite_link;
          } else {
            totalErrors++;
            continue;
          }
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }

        // Send DM with new links
        if (chatLink || channelLink) {
          const keyboard: { inline_keyboard: Array<Array<{ text: string; url: string }>> } = { inline_keyboard: [] };
          if (chatLink) keyboard.inline_keyboard.push([{ text: '💬 Войти в чат', url: chatLink }]);
          if (channelLink) keyboard.inline_keyboard.push([{ text: '📣 Войти в канал', url: channelLink }]);

          // PATCH P0.9.8c: Add club name to reinvite DM
          const reinviteClubName = (club as any).club_name || 'клуб';

          // PATCH NAME-V: безопасное обращение по имени, всегда «Вы».
          let reinviteNamePrefix = '';
          if (ghostUserId) {
            const { data: ghProfile } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('user_id', ghostUserId)
              .maybeSingle();
            reinviteNamePrefix = greetPrefix(ghProfile);
          }

          const reinviteText =
            `🔔 <b>Напоминание!</b>\n\n${reinviteNamePrefix}` +
            `Вижу, что Вы ещё не зашли в <b>${reinviteClubName}</b> по предыдущей ссылке.\n` +
            `Вот новые одноразовые ссылки:\n\n⚠️ Ссылки действуют 24 часа — переходите сейчас!`;

          const dmResult = await telegramRequest(botToken, 'sendMessage', {
            chat_id: ghost.telegram_user_id,
            text: reinviteText,
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });

          if (dmResult.rate_limited) break;

          // Mirror to admin chat (Contact Center)
          if (dmResult?.ok && dmResult?.result?.message_id && ghostUserId) {
            await logAutomatedTelegramMessage({
              supabase,
              user_id: ghostUserId,
              telegram_user_id: ghost.telegram_user_id,
              bot_id: bot?.id ?? null,
              text: reinviteText.replace(/<[^>]*>/g, ''),
              telegram_message_id: dmResult.result.message_id,
              reply_markup: keyboard,
              source: 'telegram-reinvite-ghosts',
              extra_meta: { club_id: club.id, event: 'reinvite_dm' },
            });
          }

          // Save to telegram_invite_links
          const now24h = new Date(Date.now() + 86400 * 1000).toISOString();
          if (chatLink && club.chat_id) {
            const chatCode = extractInviteCode(chatLink);
            const { data: chatInv } = await supabase.from('telegram_invite_links').insert({
              club_id: club.id,
              profile_id: ghost.profile_id,
              telegram_user_id: ghost.telegram_user_id,
              invite_link: chatLink,
              invite_code: chatCode,
              target_type: 'chat',
              target_chat_id: club.chat_id,
              status: 'sent',
              sent_at: new Date().toISOString(),
              expires_at: now24h,
              member_limit: 1,
              source: 'cron_reinvite',
            }).select('id').maybeSingle();

            // v5.3: INVITE_CREATED audit (chat / reinvite)
            await supabase.from('telegram_access_audit').insert({
              club_id: club.id,
              telegram_user_id: ghost.telegram_user_id,
              event_type: 'INVITE_CREATED',
              actor_type: 'system',
              reason: 'cron_reinvite',
              meta: {
                club_id: club.id,
                tg_id: ghost.telegram_user_id,
                expected_tg_id: ghost.telegram_user_id,
                invite_link_id: chatInv?.id || null,
                invite_code: chatCode,
                target_type: 'chat',
                target_chat_id: club.chat_id,
                member_limit: 1,
                expires_at: now24h,
                source_function: 'telegram-reinvite-ghosts',
                decision: 'created',
              },
            });
          }
          if (channelLink && club.channel_id) {
            const chCode = extractInviteCode(channelLink);
            const { data: chInv } = await supabase.from('telegram_invite_links').insert({
              club_id: club.id,
              profile_id: ghost.profile_id,
              telegram_user_id: ghost.telegram_user_id,
              invite_link: channelLink,
              invite_code: chCode,
              target_type: 'channel',
              target_chat_id: club.channel_id,
              status: 'sent',
              sent_at: new Date().toISOString(),
              expires_at: now24h,
              member_limit: 1,
              source: 'cron_reinvite',
            }).select('id').maybeSingle();

            // v5.3: INVITE_CREATED audit (channel / reinvite)
            await supabase.from('telegram_access_audit').insert({
              club_id: club.id,
              telegram_user_id: ghost.telegram_user_id,
              event_type: 'INVITE_CREATED',
              actor_type: 'system',
              reason: 'cron_reinvite',
              meta: {
                club_id: club.id,
                tg_id: ghost.telegram_user_id,
                expected_tg_id: ghost.telegram_user_id,
                invite_link_id: chInv?.id || null,
                invite_code: chCode,
                target_type: 'channel',
                target_chat_id: club.channel_id,
                member_limit: 1,
                expires_at: now24h,
                source_function: 'telegram-reinvite-ghosts',
                decision: 'created',
              },
            });
          }

          // Update member record
          await supabase.from('telegram_club_members').update({
            invite_sent_at: new Date().toISOString(),
            invite_status: 'resent',
            updated_at: new Date().toISOString(),
          }).eq('id', ghost.id);

          // Audit (legacy CRON_REINVITE summary per ghost — kept for compatibility)
          await supabase.from('telegram_access_audit').insert({
            club_id: club.id,
            telegram_user_id: ghost.telegram_user_id,
            event_type: 'CRON_REINVITE',
            actor_type: 'system',
            reason: 'cron_reinvite',
            meta: {
              chat_link: !!chatLink,
              channel_link: !!channelLink,
              dm_sent: dmResult.ok,
              source_function: 'telegram-reinvite-ghosts',
            },
          });

          totalReinvited++;
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }
      }
    }

    // Summary audit
    if (totalProcessed > 0) {
      await supabase.from('audit_logs').insert({
        action: 'telegram.reinvite_ghosts_cron',
        actor_type: 'system',
        actor_user_id: null,
        meta: {
          processed: totalProcessed,
          verified: totalVerified,
          reinvited: totalReinvited,
          skipped: totalSkipped,
          errors: totalErrors,
          runtime_ms: Date.now() - startTime,
        },
      });
    }

    console.log(`[reinvite-ghosts] Done: processed=${totalProcessed} verified=${totalVerified} reinvited=${totalReinvited} skipped=${totalSkipped} errors=${totalErrors} ms=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      ok: true,
      processed: totalProcessed,
      verified: totalVerified,
      reinvited: totalReinvited,
      skipped: totalSkipped,
      errors: totalErrors,
      runtime_ms: Date.now() - startTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[reinvite-ghosts] Error:', error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
