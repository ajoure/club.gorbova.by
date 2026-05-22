import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasCommercialAccess } from '../_shared/accessValidation.ts';
import { executeRevoke, type RevokeContext } from '../_shared/access-revoker.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RevokeAccessRequest {
  user_id?: string;
  telegram_user_id?: number;
  club_id?: string;
  reason?: string;
  is_manual?: boolean;
  admin_id?: string;
  /**
   * When true: send DM + write logs only.
   * No bans and no database state changes.
   */
  dry_run?: boolean;
}


async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// CRITICAL: Ban user permanently (no automatic unban) to prevent rejoin via old links
async function banUser(botToken: string, chatId: number, userId: number): Promise<{ success: boolean; error?: string; notMember?: boolean }> {
  console.log(`Banning user ${userId} from chat ${chatId} (permanent, no unban)`);
  
  const result = await telegramRequest(botToken, 'banChatMember', {
    chat_id: chatId,
    user_id: userId,
    // Ban for 366 days to prevent rejoin - user can be unbanned manually when access is restored
    until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
  });
  
  console.log(`banChatMember result for ${chatId}:`, result);
  
  if (!result.ok) {
    if (result.description?.includes('user is not a member') || 
        result.description?.includes('PARTICIPANT_NOT_EXISTS') ||
        result.description?.includes('USER_NOT_PARTICIPANT')) {
      // User not in chat - still try to ban to prevent future joins
      console.log(`User ${userId} not in chat ${chatId}, attempting preventive ban`);
      const preventiveBan = await telegramRequest(botToken, 'banChatMember', {
        chat_id: chatId,
        user_id: userId,
        until_date: Math.floor(Date.now() / 1000) + 366 * 24 * 60 * 60,
      });
      return { success: preventiveBan.ok || true, notMember: true };
    }
    if (result.description?.includes('not enough rights')) {
      return { success: false, error: result.description };
    }
    return { success: false, error: result.description };
  }
  
  // DO NOT UNBAN - this prevents rejoin via old invite links
  // User will be unbanned when access is granted again via telegram-grant-access
  
  return { success: true };
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendMessage', body);
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
}

function getPricingUrl(): string {
  return `${getSiteUrl()}/#pricing`;
}

async function logAudit(supabase: any, event: any): Promise<string | null> {
  const { data } = await supabase.from('telegram_access_audit').insert(event).select('id').single();
  return data?.id || null;
}

// Helper to find club_id if not provided
async function findClubId(supabase: any, userId: string | null, telegramUserId: number | null): Promise<string | null> {
  // Try from telegram_access first
  if (userId) {
    const { data: access } = await supabase
      .from('telegram_access')
      .select('club_id')
      .eq('user_id', userId)
      .in('state_chat', ['joined', 'invited'])
      .limit(1)
      .single();
    
    if (access?.club_id) return access.club_id;
  }
  
  // Try from active subscription
  if (userId) {
    const { data: sub } = await supabase
      .from('subscriptions_v2')
      .select('product_id, products_v2(telegram_club_id)')
      .eq('user_id', userId)
      .in('status', ['active', 'trial'])
      .limit(1)
      .single();
    
    if (sub?.products_v2?.telegram_club_id) return sub.products_v2.telegram_club_id;
  }
  
  // Try from telegram_club_members
  if (telegramUserId) {
    const { data: member } = await supabase
      .from('telegram_club_members')
      .select('club_id')
      .eq('telegram_user_id', telegramUserId)
      .in('access_status', ['active', 'joined'])
      .limit(1)
      .single();
    
    if (member?.club_id) return member.club_id;
  }
  
  // PATCH: Removed dangerous "any active club" fallback.
  // With multiple clubs, guessing is unsafe. Return null to force 400 error.
  console.warn('[findClubId] Could not determine club_id — no fallback to random club');
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Create service role client for all operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ========== AUTH GUARD (PATCH-1 + PATCH-2: Service Role bypass) ==========
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'MISSING_TOKEN' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    
    // PATCH-2: Allow Service Role Key as valid auth (for system-to-system calls from queue processor)
    const isServiceRoleCall = token === supabaseServiceKey;
    
    if (isServiceRoleCall) {
      console.log('[telegram-revoke-access] Service role call authorized');
    } else {
      // Standard user auth check
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

      if (authError || !user) {
        console.error('[telegram-revoke-access] Auth error:', authError?.message);
        return new Response(
          JSON.stringify({ error: 'Invalid token', code: 'INVALID_TOKEN' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check admin permission using service role
      const { data: hasPermission } = await supabase.rpc('has_permission', {
        _user_id: user.id,
        _permission_code: 'entitlements.manage',
      });

      if (!hasPermission) {
        // Fallback: check admin/superadmin role
        const { data: isAdmin } = await supabase.rpc('has_role', {
          _user_id: user.id,
          _role: 'admin',
        });
        const { data: isSuperAdmin } = await supabase.rpc('has_role', {
          _user_id: user.id,
          _role: 'superadmin',
        });

        if (!isAdmin && !isSuperAdmin) {
          console.warn(`[telegram-revoke-access] Forbidden: user ${user.id} lacks entitlements.manage`);
          return new Response(
            JSON.stringify({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    // ========== END AUTH GUARD ==========

    const body: RevokeAccessRequest = await req.json();
    let { user_id, telegram_user_id, club_id, reason, is_manual, admin_id } = body;
    const forceRevoke = (body as any).force_revoke === true;
    // Phase 1: read parent keys from body for downstream lineage (nullable, backward compat)
    const parentEventKey: string | null = (body as any).parent_event_key || null;
    const parentExecutionKey: string | null = (body as any).parent_execution_key || null;

    // PATCH: явное admin-действие = is_manual:true ИЛИ admin_id передан
    const isAdminAction = is_manual === true || (typeof admin_id === 'string' && admin_id.length > 0);

    console.log('Revoke access request:', {
      user_id, club_id, reason, is_manual, admin_id, isAdminAction, forceRevoke
    });

    if (!user_id && !telegram_user_id) {
      return new Response(JSON.stringify({ error: 'user_id or telegram_user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH: для admin-action club_id обязателен — findClubId не используем
    if (isAdminAction && !club_id) {
      console.error('[telegram-revoke-access] STOP: admin-revoke без club_id запрещён');
      return new Response(JSON.stringify({
        error: 'club_id required for admin revoke. Do not rely on findClubId for explicit admin actions.',
        code: 'CLUB_ID_REQUIRED_FOR_ADMIN',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // GUARD — запрет revoke если есть активный access
    // PATCH: пропускаем при isAdminAction (is_manual || admin_id) или forceRevoke
    // =================================================================
    if (user_id && !forceRevoke && !isAdminAction) {
      // COMMERCIAL-ONLY (2026-05-22): revoke смотрит только на коммерческое право (subs/ents/manual + billing-day).
      // Stale telegram_access projection больше не блокирует revoke. Admin/creator guard остаётся в kick-функциях.
      const accessResult = await hasCommercialAccess(supabase, user_id, club_id || undefined);
      
      if (accessResult.valid) {
        const accessSource = accessResult.source || 'unknown';
        const accessEndAt = accessResult.endAt;
        
        console.log(`[BLOCKED REVOKE] User ${user_id} has valid ${accessSource} until ${accessEndAt}`);
        
        // Log blocked revoke with SYSTEM ACTOR
        await supabase.from('audit_logs').insert({
          action: 'telegram.revoke_blocked',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'telegram-revoke-access',
          target_user_id: user_id,
          meta: {
            reason: 'access_still_valid',
            access_source: accessSource,
            subscription_id: accessResult.subscriptionId || null,
            entitlement_id: accessResult.entitlementId || null,
            manual_access_id: accessResult.manualAccessId || null,
            access_end_at: accessEndAt,
            original_revoke_reason: reason,
          }
        });

        // Phase 1 Ledger: blocked revoke → skip
        try {
          const skipEntry: LedgerEntry = {
            source_event_type: 'system',
            source_event_key: `tg-revoke-blocked:${user_id}:${club_id || 'unknown'}:${accessResult.subscriptionId || accessResult.entitlementId || accessResult.manualAccessId || 'unknown'}`,
            source_subject_type: 'system',
            source_subject_ref: user_id,
            action_type: 'skip',
            reason_code: 'already_active',
            target_type: 'club',
            target_key: `${user_id}:${club_id || 'unknown'}`,
            target_ref: club_id || null,
            user_id: user_id,
            status: 'skipped',
            result: {
              skip_reason: 'access_still_valid',
              access_source: accessSource,
              access_end_at: accessEndAt,
              reconcile_basis: 'revoke_blocked_valid_access',
            },
            parent_event_key: parentEventKey,
            parent_execution_key: parentExecutionKey,
          };
          await writeLedgerEntry(supabase, skipEntry);
        } catch (ledgerErr) {
          console.error('[telegram-revoke-access] Ledger skip write error (non-blocking):', ledgerErr);
        }

        return new Response(JSON.stringify({
          success: false,
          blocked: true,
          reason: 'access_still_valid',
          access_source: accessSource,
          access_end_at: accessEndAt,
          message: `Revoke blocked: user has active ${accessSource} until ${accessEndAt}`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (isAdminAction) {
      console.log(`[telegram-revoke-access] Guard bypassed: isAdminAction=true (is_manual=${is_manual}, admin_id=${admin_id ? 'set' : 'null'})`);
    }

    // Determine telegram_user_id and profileUserId first
    let telegramUserId: number | null = telegram_user_id || null;
    let profileUserId: string | null = user_id || null;

    if (user_id && !telegramUserId) {
      // Try finding by profiles.user_id first
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, id, user_id')
        .eq('user_id', user_id)
        .single();
      if (profile?.telegram_user_id) {
        telegramUserId = Number(profile.telegram_user_id);
        profileUserId = profile.user_id || user_id;
      } else {
        // Fallback: try finding by profiles.id (some systems use profile id as user_id)
        const { data: profileById } = await supabase
          .from('profiles')
          .select('telegram_user_id, id, user_id')
          .eq('id', user_id)
          .single();
        if (profileById?.telegram_user_id) {
          telegramUserId = Number(profileById.telegram_user_id);
          profileUserId = profileById.user_id || user_id;
        }
      }
    }

    if (telegramUserId && !profileUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('telegram_user_id', telegramUserId)
        .single();
      if (profile?.user_id) {
        profileUserId = profile.user_id;
      }
    }

    // If club_id not provided, try to find it
    if (!club_id) {
      console.log('No club_id provided, attempting to find...');
      const foundClubId = await findClubId(supabase, profileUserId, telegramUserId);
      club_id = foundClubId || undefined;
      console.log('Found club_id:', club_id);
    }

    if (!club_id) {
      console.error('Could not determine club_id for user', { user_id, telegram_user_id });
      return new Response(JSON.stringify({ error: 'club_id required and could not be determined' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If user has no Telegram linked, we cannot ban/DM.
    // Send email fallback (requested behavior) and still mark access as revoked in DB.
    if (!telegramUserId && profileUserId) {
      console.log('No telegram_user_id linked. Using email fallback only.');

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', profileUserId)
        .single();

      let emailSent = false;
      if (profile?.email) {
        try {
          await supabase.functions.invoke('send-email', {
            body: {
              to: profile.email,
              subject: '❌ Доступ к клубу отозван',
              html: `
                <p>Здравствуйте${profile.full_name ? ', ' + profile.full_name : ''}!</p>
                <p>Ваш доступ к клубу был закрыт.</p>
                ${reason ? `<p>Причина: ${reason}</p>` : ''}
                <p><a href="${getPricingUrl()}">Продлить подписку</a></p>
              `,
            },
          });
          emailSent = true;
          console.log('Email fallback sent (no telegram linked) to:', profile.email);
        } catch (emailErr) {
          console.error('Email fallback failed (no telegram linked):', emailErr);
        }
      }

      // Update telegram_access if present
      // PATCH: active_until=NULL is CRITICAL — otherwise sync will read it and return 'ok' again
      await supabase.from('telegram_access').update({
        state_chat: 'revoked',
        state_channel: 'revoked',
        active_until: null,
        last_sync_at: new Date().toISOString(),
      }).eq('user_id', profileUserId).eq('club_id', club_id);

      // Update access grants
      await supabase.from('telegram_access_grants').update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: admin_id || null,
        revoke_reason: reason || 'manual_revoke',
      }).eq('user_id', profileUserId).eq('club_id', club_id).eq('status', 'active');

      // Log audit + legacy
      const noTgAuditId = await logAudit(supabase, {
        club_id,
        user_id: profileUserId,
        telegram_user_id: null,
        event_type: 'REVOKE',
        actor_type: is_manual ? 'admin' : 'system',
        actor_id: admin_id,
        reason,
        meta: { dm_sent: false, dm_error: 'no_telegram_linked', email_sent: emailSent },
      });

      await supabase.from('telegram_logs').insert({
        user_id: profileUserId,
        club_id,
        action: is_manual ? 'MANUAL_REVOKE' : 'AUTO_REVOKE',
        target: 'both',
        status: emailSent ? 'email_only' : 'error',
        meta: { reason, email_sent: emailSent, note: 'no_telegram_linked' },
      });

      // Phase 1 Ledger: one row for no-telegram-linked revoke outcome
      try {
        const revokeCtx: RevokeContext = {
          userId: profileUserId!,
          targetType: 'club',
          targetKey: `${profileUserId}:${club_id}`,
          targetRef: club_id,
          reasonCode: isAdminAction ? 'admin_revoke' : 'subscription_expired',
          reconcileBasis: isAdminAction ? 'admin_manual_revoke' : (reason || 'no_telegram_linked'),
          sourceEventType: isAdminAction ? 'admin' : 'system',
          sourceEventKey: `tg-revoke:${profileUserId}:${club_id}:${noTgAuditId || 'no-audit'}`,
          sourceSubjectType: isAdminAction ? 'admin_action' : 'system',
          sourceSubjectRef: admin_id || profileUserId || null,
          parentEventKey: parentEventKey,
          parentExecutionKey: parentExecutionKey,
          clubId: club_id,
        };
        const revokeResult = await executeRevoke(supabase, revokeCtx);
        console.log(`[telegram-revoke-access] Ledger (no-tg): revoked=${revokeResult.revoked}, id=${revokeResult.ledgerId}`);
      } catch (ledgerErr) {
        console.error('[telegram-revoke-access] Ledger error (non-blocking):', ledgerErr);
      }

      return new Response(JSON.stringify({
        success: true,
        chat_revoked: false,
        channel_revoked: false,
        dm_sent: false,
        email_sent: emailSent,
        note: 'no_telegram_linked',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get club with bot
    const { data: club, error: clubError } = await supabase
      .from('telegram_clubs')
      .select('*, telegram_bots(*)')
      .eq('id', club_id)
      .single();

    if (clubError || !club) {
      return new Response(JSON.stringify({ error: 'Club not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bot = club.telegram_bots;
    if (!bot || bot.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Bot inactive' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!telegramUserId) {
      return new Response(JSON.stringify({ error: 'Could not determine telegram_user_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = bot.bot_token_encrypted;
    let chatKickResult: { success: boolean; error?: string; notMember?: boolean } | null = null;
    let channelKickResult: { success: boolean; error?: string; notMember?: boolean } | null = null;

    // Ban from chat (permanent until access is restored)
    if (club.chat_id) {
      console.log(`Banning from chat ${club.chat_id}...`);
      chatKickResult = await banUser(botToken, club.chat_id, telegramUserId);
      console.log('Chat ban result:', chatKickResult);
    }

    // Ban from channel (permanent until access is restored)
    if (club.channel_id) {
      console.log(`Banning from channel ${club.channel_id}...`);
      channelKickResult = await banUser(botToken, club.channel_id, telegramUserId);
      console.log('Channel ban result:', channelKickResult);
    }

    const chatRevoked = chatKickResult?.success ?? false;
    const channelRevoked = channelKickResult?.success ?? false;

    // Update telegram_access
    // PATCH: Set active_until = now()-1s (past) + state='revoked' for double protection.
    // active_until=NULL was buggy: accessValidation treats NULL as "infinite access"!
    if (profileUserId) {
      await supabase.from('telegram_access').update({
        state_chat: 'revoked',
        state_channel: 'revoked',
        active_until: new Date(Date.now() - 1000).toISOString(), // 1s in past = access expired
        last_sync_at: new Date().toISOString(),
      }).eq('user_id', profileUserId).eq('club_id', club_id);

      // Deactivate manual access
      if (is_manual) {
        await supabase.from('telegram_manual_access').update({
          is_active: false,
        }).eq('user_id', profileUserId).eq('club_id', club_id);
      }

      // Update access grants
      await supabase.from('telegram_access_grants').update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: admin_id || null,
        revoke_reason: reason || 'manual_revoke',
      }).eq('user_id', profileUserId).eq('club_id', club_id).eq('status', 'active');
    }

    // ADMIN GUARD: Check if user is administrator/creator before marking as removed
    // Admins cannot be banned by Telegram, so we must not falsify their in_chat/in_channel state
    const { data: memberRecord } = await supabase
      .from('telegram_club_members')
      .select('last_telegram_check_result')
      .eq('telegram_user_id', telegramUserId)
      .eq('club_id', club_id)
      .maybeSingle();

    const memberChatStatus = (memberRecord?.last_telegram_check_result as any)?.chat?.status;
    const memberChannelStatus = (memberRecord?.last_telegram_check_result as any)?.channel?.status;
    const isMemberAdmin = ['administrator', 'creator'].includes(memberChatStatus) || ['administrator', 'creator'].includes(memberChannelStatus);

    if (isMemberAdmin) {
      console.log(`ADMIN_PROTECTED: user ${telegramUserId} is ${memberChatStatus || memberChannelStatus} — skipping in_chat/access_status update`);
      await supabase.from('audit_logs').insert({
        action: 'telegram.revoke.admin_protected',
        actor_type: is_manual ? 'admin' : 'system',
        actor_user_id: admin_id || null,
        actor_label: 'telegram-revoke-access',
        meta: {
          tg_user_id: telegramUserId,
          club_id,
          chat_status: memberChatStatus,
          channel_status: memberChannelStatus,
          reason: 'cannot_remove_admin',
        },
      });
    } else {
      // Update member record — only for non-admin users
      await supabase.from('telegram_club_members').update({
        in_chat: chatRevoked ? false : undefined,
        in_channel: channelRevoked ? false : undefined,
        access_status: 'removed',
        updated_at: new Date().toISOString(),
      }).eq('telegram_user_id', telegramUserId).eq('club_id', club_id);
    }

    // PATCH-FINAL: Do NOT set was_club_member at kick/revoke time.
    // Reentry pricing activates ONLY after grace period expires (in markAsExpiredReentry).
    // Membership state (removed/kicked) does not affect pricing.
    if (profileUserId) {
      await supabase.from('profiles').update({
        club_exit_at: new Date().toISOString(),
        club_exit_reason: reason || 'access_revoked',
      }).eq('user_id', profileUserId);
      console.log(`Updated club_exit for user ${profileUserId} (no reentry pricing at kick)`);
    }

    // Send notification via Telegram
    let dmResult: any = null;
    const keyboard = {
      inline_keyboard: [[{ text: '💳 Продлить подписку', url: getPricingUrl() }]],
    };
    // Get club name for better DM
    let clubName = 'клуба';
    try {
      const { data: clubInfo } = await supabase
        .from('telegram_clubs')
        .select('name')
        .eq('id', club_id)
        .maybeSingle();
      if (clubInfo?.name) clubName = clubInfo.name;
    } catch {}

    const reasonText = reason === 'subscription_expired'
      ? 'Срок действия подписки истёк.'
      : reason === 'manual_revoke'
      ? 'Доступ отозван администратором.'
      : 'Доступ к клубу закрыт.';

    dmResult = await sendMessage(
      botToken,
      telegramUserId,
      `❌ Доступ отозван — ${clubName}\n\n${reasonText}\n\nВы можете вернуться в любой момент, оформив подписку 👇`,
      keyboard
    );

    // Email fallback if Telegram DM failed
    if (!dmResult?.ok && profileUserId) {
      console.log('Telegram DM failed, attempting email fallback...');
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', profileUserId)
        .single();
      
      if (profile?.email) {
        try {
          await supabase.functions.invoke('send-email', {
            body: {
              to: profile.email,
              subject: '❌ Доступ к клубу отозван',
              html: `
                <p>Здравствуйте${profile.full_name ? ', ' + profile.full_name : ''}!</p>
                <p>Ваш доступ к клубу был закрыт.</p>
                ${reason ? `<p>Причина: ${reason}</p>` : ''}
                <p><a href="${getPricingUrl()}">Продлить подписку</a></p>
              `,
            },
          });
          console.log('Email fallback sent to:', profile.email);
        } catch (emailErr) {
          console.error('Email fallback failed:', emailErr);
        }
      }
    }

    // Log audit
    const mainAuditId = await logAudit(supabase, {
      club_id,
      user_id: profileUserId,
      telegram_user_id: telegramUserId,
      event_type: 'REVOKE',
      actor_type: is_manual ? 'admin' : 'system',
      actor_id: admin_id,
      reason,
      telegram_chat_result: chatKickResult,
      telegram_channel_result: channelKickResult,
      meta: { dm_sent: dmResult?.ok, dm_error: dmResult?.description },
    });

    // Legacy log
    await supabase.from('telegram_logs').insert({
      user_id: profileUserId,
      club_id,
      action: is_manual ? 'MANUAL_REVOKE' : 'AUTO_REVOKE',
      target: 'both',
      status: (chatRevoked || channelRevoked) ? 'ok' : 'partial',
      meta: { telegram_user_id: telegramUserId, chat_revoked: chatRevoked, channel_revoked: channelRevoked, reason },
    });

    // Phase 1 Ledger: one row for final revoke outcome
    try {
      const revokeCtx: RevokeContext = {
        userId: profileUserId || user_id!,
        targetType: 'club',
        targetKey: `${profileUserId || user_id}:${club_id}`,
        targetRef: club_id,
        reasonCode: isAdminAction ? 'admin_revoke' : (reason === 'subscription_expired' ? 'subscription_expired' : reason === 'violation_kick' ? 'violation_kick' : reason === 'cron_cleanup' ? 'cron_cleanup' : 'admin_revoke'),
        reconcileBasis: isAdminAction ? 'admin_manual_revoke' : (reason || 'system_revoke'),
        sourceEventType: isAdminAction ? 'admin' : 'system',
        sourceEventKey: `tg-revoke:${profileUserId || user_id}:${club_id}:${mainAuditId || 'no-audit'}`,
        sourceSubjectType: isAdminAction ? 'admin_action' : ((body as any).source_subject_type || 'system'),
        sourceSubjectRef: admin_id || profileUserId || null,
        parentEventKey: parentEventKey,
        parentExecutionKey: parentExecutionKey,
        clubId: club_id,
      };
      const revokeResult = await executeRevoke(supabase, revokeCtx);
      console.log(`[telegram-revoke-access] Ledger: revoked=${revokeResult.revoked}, id=${revokeResult.ledgerId}`);
    } catch (ledgerErr) {
      console.error('[telegram-revoke-access] Ledger error (non-blocking):', ledgerErr);
    }

    console.log('Revoke completed:', { telegramUserId, chatRevoked, channelRevoked, dm_sent: dmResult?.ok });

    return new Response(JSON.stringify({
      success: true,
      chat_revoked: chatRevoked,
      channel_revoked: channelRevoked,
      chat_error: chatKickResult?.error,
      channel_error: channelKickResult?.error,
      dm_sent: dmResult?.ok,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Revoke access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
