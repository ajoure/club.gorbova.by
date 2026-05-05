// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasValidAccess } from '../_shared/accessValidation.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';
import { greetPrefix } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GrantAccessRequest {
  user_id: string;
  club_id?: string;
  club_ids?: string[];       // Array of club IDs (use full array, not just first)
  is_manual?: boolean;
  admin_id?: string;
  valid_until?: string;
  comment?: string;
  source?: string;
  source_id?: string;
  tariff_name?: string;      // For logging in telegram chat
  product_name?: string;     // For logging in telegram chat
  duration_days?: number;    // For calculating access end
  // Sub-patch B: Parent lineage for downstream ledger propagation
  parent_event_key?: string | null;
  parent_execution_key?: string | null;
  _from_primary_path?: boolean;
}

// PATCH 13+: Throttle delay between Telegram API calls
const THROTTLE_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function telegramRequest(botToken: string, method: string, params: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  console.log(`Telegram API: ${method}`, params);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const result = await response.json();
  
  // PATCH 13+: Check for rate limit (429)
  if (!result.ok && result.error_code === 429) {
    const retryAfter = result.parameters?.retry_after || 60;
    console.warn(`Telegram rate limited! Retry after ${retryAfter}s`);
    return { 
      ...result, 
      rate_limited: true, 
      retry_after: retryAfter 
    };
  }
  
  return result;
}

async function unbanUser(
  botToken: string, 
  chatId: number, 
  userId: number
): Promise<{ success: boolean; error?: string; was_banned?: boolean; status?: string }> {
  // Step 1: Check current member status
  const chatMember = await telegramRequest(botToken, 'getChatMember', {
    chat_id: chatId,
    user_id: userId,
  });
  
  const status = chatMember.result?.status;
  console.log(`[unbanUser] User ${userId} status in chat ${chatId}: ${status}`);
  
  // Already a member — no action needed
  if (status === 'member' || status === 'administrator' || status === 'creator') {
    return { success: true, was_banned: false, status };
  }
  
  // Needs unban (kicked, left, or restricted)
  if (status === 'kicked' || status === 'left' || status === 'restricted') {
    // CRITICAL FIX: Use only_if_banned: false to also lift 'kicked' status
    const result = await telegramRequest(botToken, 'unbanChatMember', {
      chat_id: chatId,
      user_id: userId,
      only_if_banned: false, // Works for both kicked and banned
    });
    
    if (!result.ok) {
      console.error(`[unbanUser] Unban failed for user ${userId}:`, result);
      return { success: false, error: result.description, was_banned: true, status };
    }
    
    console.log(`[unbanUser] Successfully unbanned user ${userId} (was: ${status})`);
    return { success: true, was_banned: true, status };
  }
  
  return { success: true, was_banned: false, status };
}

// Create invite link with join request mode if enabled
async function createInviteLink(
  botToken: string, 
  chatId: number, 
  name: string,
  joinRequestMode: boolean
): Promise<{ link?: string; error?: string }> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    name: name || 'Auto-generated invite',
  };

  // CRITICAL: If join_request_mode is enabled, create links that require approval
  if (joinRequestMode) {
    params.creates_join_request = true;
    delete params.member_limit; // Can't use member_limit with creates_join_request
  }

  const result = await telegramRequest(botToken, 'createChatInviteLink', params);

  if (result.ok) {
    return { link: result.result.invite_link, invite_link_obj: result.result };
  }
  console.error('Failed to create invite link:', result);
  return { error: result.description || 'Failed to create invite link' };
}

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest(botToken, 'sendMessage', body);
}

// Send tariff media (photo, video, document, video_note)
async function sendTariffMedia(
  supabase: any,
  botToken: string,
  chatId: number,
  media: { type?: string; storage_path?: string }
): Promise<{ ok: boolean; message_id?: number; media_type?: string; filename?: string }> {
  if (!media.type || !media.storage_path) return { ok: false };
  
  try {
    // Download from Storage
    const { data, error } = await supabase.storage
      .from('tariff-media')
      .download(media.storage_path);
    
    if (error || !data) {
      console.error('Failed to download tariff media:', error);
      return { ok: false };
    }

    // Get filename from path
    const filename = media.storage_path.split('/').pop() || 'file';
    
    // Determine method and field based on type
    const methodMap: Record<string, { method: string; field: string }> = {
      photo: { method: 'sendPhoto', field: 'photo' },
      video: { method: 'sendVideo', field: 'video' },
      document: { method: 'sendDocument', field: 'document' },
      video_note: { method: 'sendVideoNote', field: 'video_note' },
    };
    
    const config = methodMap[media.type] || methodMap.document;
    
    // Create FormData and send
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append(config.field, new Blob([await data.arrayBuffer()]), filename);
    
    // Video notes require specific dimensions
    if (media.type === 'video_note') {
      formData.append('length', '384');
    }
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${config.method}`, {
      method: 'POST',
      body: formData,
    });
    
    const result = await response.json();
    if (!result.ok) {
      console.error('Telegram send media error:', result);
      return { ok: false };
    }
    console.log('Sent tariff media:', media.type);
    return {
      ok: true,
      message_id: result.result?.message_id,
      media_type: media.type,
      filename,
    };
  } catch (err) {
    console.error('Error sending tariff media:', err);
    return { ok: false };
  }
}

// Mirror welcome media to telegram_messages with placeholder text
async function mirrorWelcomeMedia(params: {
  supabase: any;
  user_id: string;
  telegram_user_id: number;
  bot_id: string | null;
  club_id: string;
  source_id: string | null;
  event: string;
  media_result: { ok: boolean; message_id?: number; media_type?: string; filename?: string };
}) {
  const { media_result, event, ...rest } = params;
  if (!media_result.ok || !media_result.message_id) return;
  const placeholder = `[медиа: ${media_result.media_type}]${media_result.filename ? ' ' + media_result.filename : ''}`;
  await logAutomatedTelegramMessage({
    supabase: rest.supabase,
    user_id: rest.user_id,
    telegram_user_id: rest.telegram_user_id,
    bot_id: rest.bot_id,
    text: placeholder,
    telegram_message_id: media_result.message_id,
    source: 'telegram-grant-access',
    extra_meta: {
      club_id: rest.club_id,
      source_id: rest.source_id,
      event,
      media_type: media_result.media_type,
      telegram_message_id: media_result.message_id,
    },
  });
}

function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
}

// Log audit
async function logAudit(supabase: any, event: any) {
  await supabase.from('telegram_access_audit').insert(event);
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
      console.log('[telegram-grant-access] Service role call authorized');
    } else {
      // Standard user auth check
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

      if (authError || !user) {
        console.error('[telegram-grant-access] Auth error:', authError?.message);
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
          console.warn(`[telegram-grant-access] Forbidden: user ${user.id} lacks entitlements.manage`);
          return new Response(
            JSON.stringify({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    // ========== END AUTH GUARD ==========

    const body: GrantAccessRequest = await req.json();
    const { user_id, club_id, club_ids, is_manual, admin_id, valid_until, comment, source, source_id, tariff_name, product_name, duration_days, parent_event_key, parent_execution_key, _from_primary_path } = body;

    // Sub-patch B: Validate parent lineage contract
    if (_from_primary_path === true && (!parent_event_key || !parent_execution_key)) {
      return new Response(JSON.stringify({ 
        error: '_from_primary_path=true requires parent_event_key and parent_execution_key',
        code: 'MISSING_PARENT_LINEAGE',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Grant access request:', body);

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GUARD 1: Cannot provide both club_id and club_ids — ambiguous contract
    if (club_id && club_ids?.length) {
      return new Response(JSON.stringify({ error: 'Cannot provide both club_id and club_ids — pick one' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve club IDs: use full array, never just first element
    const resolvedClubIds: string[] = club_ids ?? (club_id ? [club_id] : []);

    // GUARD 2: club_id/club_ids is ALWAYS required — no exceptions, even for manual calls
    if (resolvedClubIds.length === 0) {
      console.error('CRITICAL: Call without club_id/club_ids — refusing to grant. is_manual=' + is_manual);
      await supabase.from('audit_logs').insert({
        action: 'telegram.grant.missing_club_id',
        actor_type: 'system',
        actor_label: 'telegram-grant-access',
        meta: { user_id, source, source_id, is_manual, body_keys: Object.keys(body) },
      });
      return new Response(JSON.stringify({ error: 'club_id or club_ids is required — access to all clubs is never granted automatically' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user profile - user_id in the request maps to profiles.user_id (auth id)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!profile.telegram_user_id) {
      // Queue notification for when user links telegram
      console.log('Telegram not linked, queueing notification');
      
      // Get club info for context
      // Use resolvedClubIds — NO fallback to "first active club"
      const targetClubId = resolvedClubIds[0]; // Already validated non-empty above

      // Queue access granted notification
      await supabase.from('pending_telegram_notifications').insert({
        user_id,
        notification_type: 'access_granted',
        club_id: targetClubId,
        payload: {
          pending_access: true,
          source: source || (is_manual ? 'manual' : 'system'),
          comment,
          valid_until,
        },
        priority: 10, // High priority for access notifications
      });

      // Mark telegram_access as pending
      if (targetClubId) {
        await supabase.from('telegram_access').upsert({
          user_id,
          club_id: targetClubId,
          state_chat: 'pending',
          state_channel: 'pending',
          invites_pending: true,
          active_until: valid_until || null,
        }, { onConflict: 'user_id,club_id' });
      }

      const wasMirroredToMessages = !!(dmSent && result?.ok && result?.result?.message_id);

      await supabase.from('telegram_logs').insert({
        user_id, action: 'GRANT_QUEUED', status: 'ok', 
        error_message: 'Telegram not linked - notification queued',
        club_id: targetClubId,
      });

      return new Response(JSON.stringify({ 
        success: true, 
        queued: true,
        message: 'Notification queued - will be sent when user links Telegram',
        code: 'TG_NOT_LINKED_QUEUED' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // PATCH TG-REVOKE-FALSE-REGRANT: Guard — revoke race protection
    // For non-manual (auto) grants, check if user was recently revoked
    // ============================================================
    if (!is_manual) {
      for (const cid of resolvedClubIds) {
        // Check for recent revoke (within 5 minutes)
        const { data: recentRevoke } = await supabase
          .from('telegram_access')
          .select('id, state_chat, updated_at')
          .eq('user_id', user_id)
          .eq('club_id', cid)
          .eq('state_chat', 'revoked')
          .gt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
          .maybeSingle();

        if (recentRevoke) {
          // Double-check: does the user actually have valid access?
          const accessCheck = await hasValidAccess(supabase, user_id, cid);
          
          if (!accessCheck.valid) {
            console.log(`[grant-access] BLOCKED: user ${user_id} was recently revoked in club ${cid} and has no valid access. Refusing auto-grant.`);
            
            await supabase.from('audit_logs').insert({
              action: 'telegram.grant_blocked',
              actor_type: 'system',
              actor_label: 'telegram-grant-access',
              meta: {
                user_id,
                club_id: cid,
                source,
                source_id,
                reason_code: 'grant_blocked',
                trigger_type: is_manual ? 'manual' : 'queue',
                decision: 'blocked',
                detail: 'recent_revoke_no_valid_access',
                revoke_at: recentRevoke.updated_at,
              },
            });

            return new Response(JSON.stringify({ 
              success: false, 
              blocked: true, 
              reason: 'User was recently revoked and has no valid access',
              code: 'GRANT_BLOCKED_AFTER_REVOKE',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
    }

    // ============================================================
    // PATCH TG-CLUB-LINKAGE-INTEGRITY: Verify club-product mapping for auto grants
    // ============================================================
    if (!is_manual && source_id) {
      // Try to resolve product from source subscription
      const { data: sourceSub } = await supabase
        .from('subscriptions_v2')
        .select('product_id')
        .eq('id', source_id)
        .maybeSingle();

      if (sourceSub?.product_id) {
        for (const cid of resolvedClubIds) {
          const { data: ruleCheck } = await supabase
            .from('access_rules')
            .select('id')
            .eq('product_id', sourceSub.product_id)
            .eq('target_ref', cid)
            .eq('grant_target_type', 'club')
            .eq('is_active', true)
            .maybeSingle();

          if (!ruleCheck) {
            console.log(`[grant-access] BLOCKED: club_product_mismatch — product ${sourceSub.product_id} not mapped to club ${cid}`);
            
            await supabase.from('audit_logs').insert({
              action: 'telegram.grant_blocked',
              actor_type: 'system',
              actor_label: 'telegram-grant-access',
              meta: {
                user_id,
                club_id: cid,
                product_id: sourceSub.product_id,
                source,
                source_id,
                reason_code: 'club_product_mismatch',
                trigger_type: 'queue',
                decision: 'blocked',
              },
            });

            return new Response(JSON.stringify({ 
              success: false, 
              blocked: true, 
              reason: 'Product is not mapped to this club',
              code: 'CLUB_PRODUCT_MISMATCH',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
    }

    let clubsQuery = supabase.from('telegram_clubs').select('*, telegram_bots(*)').eq('is_active', true);
    clubsQuery = clubsQuery.in('id', resolvedClubIds);
    const { data: clubs, error: clubsError } = await clubsQuery;

    if (clubsError || !clubs?.length) {
      return new Response(JSON.stringify({ error: 'No active clubs found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    const telegramUserId = Number(profile.telegram_user_id);

    // ============================================================
    // PATCH TG-DUPLICATE-DM-GUARD: resolve canonical business order id
    // (used both for idempotency key on mirror row and for pre-send check
    // to prevent a second "Доступ открыт!" DM when both canonical order
    // path and legacy subscription queue path call this function for the
    // same paid order). Manual grants bypass this guard.
    // ============================================================
    let canonicalOrderId: string | null = null;
    if (source_id) {
      // Case 1: source_id IS an order id
      const { data: maybeOrder } = await supabase
        .from('orders_v2')
        .select('id')
        .eq('id', source_id)
        .maybeSingle();
      if (maybeOrder?.id) {
        canonicalOrderId = maybeOrder.id;
      } else {
        // Case 2: source_id is a subscription id — derive its canonical order
        const { data: maybeSub } = await supabase
          .from('subscriptions_v2')
          .select('order_id, meta')
          .eq('id', source_id)
          .maybeSingle();
        if (maybeSub) {
          const sm = (maybeSub.meta || {}) as Record<string, any>;
          canonicalOrderId =
            (maybeSub as any).order_id ||
            sm.checkout_order_id ||
            sm.initial_order_id ||
            (Array.isArray(sm.extended_by_orders) && sm.extended_by_orders[0]) ||
            null;
          if (!canonicalOrderId && typeof sm.tracking_id === 'string') {
            const m = /:order:([0-9a-f-]{36})/i.exec(sm.tracking_id);
            if (m) canonicalOrderId = m[1];
          }
        }
      }
    }
    const canonicalBusinessRef = canonicalOrderId || source_id || null;


    for (const club of clubs) {
      const bot = club.telegram_bots;
      if (!bot || bot.status !== 'active') {
        results.push({ club_id: club.id, error: 'Bot inactive' });
        continue;
      }

      const botToken = bot.bot_token_encrypted;
      const joinRequestMode = club.join_request_mode ?? false;

      let chatInviteLink: string | null = null;
      let channelInviteLink: string | null = null;
      let chatUnbanned = false;
      let channelUnbanned = false;

      // ============================================================
      // PATCH TG-DUPLICATE-DM-GUARD: skip if access_granted_dm already
      // sent for this (user, club, canonical_business_ref).
      // Skipped only for AUTO grants (is_manual=false). Manual re-issue
      // by admin is always allowed. Failed/skipped previous sends do not
      // block — we look only for successful mirror rows in telegram_messages.
      // ============================================================
      if (!is_manual && canonicalBusinessRef) {
        const dmIdempotencyKey = `access_granted_dm:${user_id}:${club.id}:${canonicalBusinessRef}`;
        try {
          const { data: existingDm } = await supabase
            .from('telegram_messages')
            .select('id, message_id, created_at')
            .eq('user_id', user_id)
            .eq('direction', 'outgoing')
            .filter('meta->>idempotency_key', 'eq', dmIdempotencyKey)
            .limit(1)
            .maybeSingle();

          // Fallback for legacy rows without idempotency_key — match by
          // (user, club, event=access_granted_dm, source_id=any of canonical refs).
          let legacyMatch: { id: string; message_id: number | null } | null = null;
          if (!existingDm) {
            const candidateRefs = Array.from(new Set([
              canonicalOrderId,
              source_id,
            ].filter(Boolean) as string[]));
            if (candidateRefs.length > 0) {
              const { data: legacy } = await supabase
                .from('telegram_messages')
                .select('id, message_id, meta, created_at')
                .eq('user_id', user_id)
                .eq('direction', 'outgoing')
                .filter('meta->>event', 'eq', 'access_granted_dm')
                .filter('meta->>club_id', 'eq', club.id)
                .in('meta->>source_id', candidateRefs)
                .order('created_at', { ascending: false })
                .limit(1);
              if (legacy && legacy.length > 0) legacyMatch = legacy[0] as any;
            }
          }

          const dup = existingDm || legacyMatch;
          if (dup) {
            console.log(`[telegram-grant-access] SKIP duplicate access_granted_dm: user=${user_id} club=${club.id} ref=${canonicalBusinessRef} existing_msg=${(dup as any).id}`);
            await supabase.from('audit_logs').insert({
              action: 'telegram.grant.skipped_duplicate_dm',
              actor_type: 'system',
              actor_label: 'telegram-grant-access',
              target_user_id: user_id,
              meta: {
                user_id,
                club_id: club.id,
                source,
                source_id,
                canonical_order_id: canonicalOrderId,
                canonical_business_ref: canonicalBusinessRef,
                idempotency_key: dmIdempotencyKey,
                existing_telegram_message_row_id: (dup as any).id,
                existing_telegram_message_id: (dup as any).message_id ?? null,
                trigger_type: 'auto',
                decision: 'skipped',
                reason_code: 'duplicate_access_granted_dm',
              },
            });
            await supabase.from('telegram_logs').insert({
              user_id,
              club_id: club.id,
              action: 'AUTO_GRANT',
              target: 'both',
              status: 'skipped',
              meta: {
                skip_reason: 'duplicate_access_granted_dm',
                canonical_order_id: canonicalOrderId,
                source,
                source_id,
                idempotency_key: dmIdempotencyKey,
                existing_telegram_message_row_id: (dup as any).id,
                mirrored_to_telegram_messages: true,
              },
            });
            results.push({
              club_id: club.id,
              skipped_duplicate: true,
              existing_message_row_id: (dup as any).id,
              dm_sent: false,
            });
            continue;
          }
        } catch (dupErr) {
          console.warn('[telegram-grant-access] duplicate-DM lookup failed (continuing):', dupErr);
        }
      }

      // Process chat
      if (club.chat_id) {
        const unbanResult = await unbanUser(botToken, club.chat_id, telegramUserId);
        chatUnbanned = unbanResult.was_banned || false;
        
        if (!unbanResult.success) {
          console.error(`[grant-access] Failed to unban user ${telegramUserId} from chat:`, unbanResult.error);
          // Log the error but continue - user might still be able to join
        }

        const inviteResult = await createInviteLink(
          botToken, 
          club.chat_id, 
          `Chat access for ${profile.email || user_id}`,
          joinRequestMode
        );
        
        // CRITICAL FIX: Don't fallback to static links for kicked/banned users
        if (inviteResult.link) {
          chatInviteLink = inviteResult.link;
        } else if (inviteResult.error) {
          console.error(`[grant-access] Failed to create chat invite for ${profile.email}:`, inviteResult.error);
          // Only use static link if user is already a member (not kicked/banned)
          if (unbanResult.status === 'member' || unbanResult.status === 'administrator') {
            chatInviteLink = club.chat_invite_link || null;
          } else {
            chatInviteLink = null; // Don't send broken static link
            console.warn(`[grant-access] Skipping static chat link - user status: ${unbanResult.status}`);
          }
        }
      }

      // Process channel
      if (club.channel_id) {
        const unbanResult = await unbanUser(botToken, club.channel_id, telegramUserId);
        channelUnbanned = unbanResult.was_banned || false;
        
        if (!unbanResult.success) {
          console.error(`[grant-access] Failed to unban user ${telegramUserId} from channel:`, unbanResult.error);
        }

        const inviteResult = await createInviteLink(
          botToken, 
          club.channel_id, 
          `Channel access for ${profile.email || user_id}`,
          joinRequestMode
        );
        
        // CRITICAL FIX: Don't fallback to static links for kicked/banned users
        if (inviteResult.link) {
          channelInviteLink = inviteResult.link;
        } else if (inviteResult.error) {
          console.error(`[grant-access] Failed to create channel invite for ${profile.email}:`, inviteResult.error);
          // Only use static link if user is already a member
          if (unbanResult.status === 'member' || unbanResult.status === 'administrator') {
            channelInviteLink = club.channel_invite_link || null;
          } else {
            channelInviteLink = null;
            console.warn(`[grant-access] Skipping static channel link - user status: ${unbanResult.status}`);
          }
        }
      }

      // Calculate active_until via unified shared helper (scoped to THIS club)
      let activeUntil: string | null = valid_until || null;
      if (!activeUntil && !is_manual) {
        const { resolveEffectiveClubAccess, effectiveEndAtIso } = await import('../_shared/resolve-effective-access.ts');
        const accessSnapshot = await resolveEffectiveClubAccess(supabase, user_id, club.id);
        activeUntil = effectiveEndAtIso(accessSnapshot);
        console.log(`[grant-access] Resolved effectiveEndAt for club ${club.id}: ${activeUntil}, sources: ${accessSnapshot.allSources.length}, unlimited: ${accessSnapshot.isUnlimited}`);
      }

      // Update telegram_access
      await supabase.from('telegram_access').upsert({
        user_id,
        club_id: club.id,
        state_chat: 'pending',
        state_channel: 'pending',
        active_until: activeUntil,
        last_sync_at: new Date().toISOString(),
      }, { onConflict: 'user_id,club_id' });

      // Create access grant record (FIX-1: Idempotency check to prevent duplicates)
      const grantSource = source || (is_manual ? 'manual' : 'system');
      let skipGrant = false;
      
      if (source_id) {
        // Check if grant already exists for this source_id (prevents duplicates on retries)
        const { data: existingGrant } = await supabase
          .from('telegram_access_grants')
          .select('id, end_at')
          .eq('user_id', user_id)
          .eq('club_id', club.id)
          .eq('source_id', source_id)
          .maybeSingle();
        
        if (existingGrant) {
          // PATCH 5 (TG-P0.9.2): Update end_at if new date is later (renewal case)
          const existingEnd = existingGrant.end_at ? new Date(existingGrant.end_at).getTime() : 0;
          const newEnd = activeUntil ? new Date(activeUntil).getTime() : Infinity;
          
          if (newEnd > existingEnd) {
            console.log(`[grant-access] Updating grant ${existingGrant.id} end_at: ${existingGrant.end_at} -> ${activeUntil}`);
            await supabase
              .from('telegram_access_grants')
              .update({ 
                end_at: activeUntil, 
                updated_at: new Date().toISOString(),
                meta: { comment, chat_invite_sent: !!chatInviteLink, channel_invite_sent: !!channelInviteLink, renewed: true },
              })
              .eq('id', existingGrant.id);
          } else {
            console.log(`[grant-access] Skip duplicate grant for source_id=${source_id}, existing grant=${existingGrant.id} (end_at already up to date)`);
          }
          skipGrant = true;
        }
      }
      
      if (!skipGrant) {
        await supabase.from('telegram_access_grants').insert({
          user_id,
          club_id: club.id,
          source: grantSource,
          source_id: source_id || null,
          granted_by: admin_id || null,
          start_at: new Date().toISOString(),
          end_at: activeUntil,
          status: 'active',
          meta: { comment, chat_invite_sent: !!chatInviteLink, channel_invite_sent: !!channelInviteLink },
        });
      }

      // Create manual access record if needed
      if (is_manual && admin_id) {
        await supabase.from('telegram_manual_access').upsert({
          user_id,
          club_id: club.id,
          is_active: true,
          valid_until: valid_until || null,
          comment: comment || null,
          created_by_admin_id: admin_id,
        }, { onConflict: 'user_id,club_id' });
      }

      // PATCH 13+: Update member record with invite tracking
      const inviteTrackingUpdate: Record<string, unknown> = {
        access_status: 'ok',
        updated_at: new Date().toISOString(),
        invite_sent_at: new Date().toISOString(),
        invite_status: 'sent',
        invite_error: null,
        invite_retry_after: null,
        last_invite_link: chatInviteLink || channelInviteLink || null,
      };

      // PATCH P0.9.8: Save invite links to telegram_invite_links
      const extractInviteCode = (link: string): string => {
        // https://t.me/+XXXXXX or https://t.me/joinchat/XXXXXX
        const plusMatch = link.match(/\+([A-Za-z0-9_-]+)$/);
        if (plusMatch) return plusMatch[1];
        const joinMatch = link.match(/joinchat\/([A-Za-z0-9_-]+)$/);
        if (joinMatch) return joinMatch[1];
        return link.split('/').pop() || link;
      };

      const inviteSource = is_manual ? 'manual_grant' : 'auto_grant';
      const now24h = new Date(Date.now() + 86400 * 1000).toISOString();

      // v5.3: BLOCKED_VERIFIED guard — if user already verified in this club, audit but allow manual re-issue
      try {
        const { data: verifiedRow } = await supabase.rpc('is_verified_club_member', {
          _club_id: club.id,
          _tg_id: telegramUserId,
        });
        if (verifiedRow === true && !is_manual) {
          await logAudit(supabase, {
            club_id: club.id,
            user_id: profile.id,
            telegram_user_id: telegramUserId,
            event_type: 'INVITE_BLOCKED_VERIFIED',
            actor_type: 'system',
            reason: 'already_verified_member',
            meta: {
              club_id: club.id,
              tg_id: telegramUserId,
              expected_tg_id: telegramUserId,
              invite_link_id: null,
              invite_code: null,
              source_function: 'telegram-grant-access',
              decision: 'blocked',
            },
          });
        }
      } catch (_e) {
        // RPC absent → degrade silently, do not block grant
      }

      // v5.3: Revoke previous active personal links before issuing a new one
      const { data: prevActive } = await supabase
        .from('telegram_invite_links')
        .select('id, invite_code, target_type')
        .eq('club_id', club.id)
        .eq('telegram_user_id', telegramUserId)
        .in('status', ['created', 'sent']);

      if (prevActive && prevActive.length > 0) {
        const prevIds = prevActive.map((p: any) => p.id);
        await supabase.from('telegram_invite_links')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .in('id', prevIds);

        for (const p of prevActive) {
          await logAudit(supabase, {
            club_id: club.id,
            user_id: profile.id,
            telegram_user_id: telegramUserId,
            event_type: 'INVITE_REVOKED',
            actor_type: is_manual ? 'admin' : 'system',
            reason: 'replaced_by_new_invite',
            meta: {
              club_id: club.id,
              tg_id: telegramUserId,
              expected_tg_id: telegramUserId,
              invite_link_id: p.id,
              invite_code: p.invite_code,
              target_type: p.target_type,
              source_function: 'telegram-grant-access',
              decision: 'revoked',
            },
          });
        }
      }

      if (chatInviteLink && club.chat_id) {
        const code = extractInviteCode(chatInviteLink);
        const { data: inviteRecord } = await supabase.from('telegram_invite_links').insert({
          club_id: club.id,
          profile_id: profile.id,
          telegram_user_id: telegramUserId,
          invite_link: chatInviteLink,
          invite_code: code,
          target_type: 'chat',
          target_chat_id: club.chat_id,
          status: 'sent',
          sent_at: new Date().toISOString(),
          expires_at: now24h,
          member_limit: 1,
          source: inviteSource,
          source_id: source_id || null,
        }).select('id').maybeSingle();
        
        if (inviteRecord) {
          inviteTrackingUpdate.last_invite_id = inviteRecord.id;
        }

        // v5.3: INVITE_CREATED audit (chat)
        await logAudit(supabase, {
          club_id: club.id,
          user_id: profile.id,
          telegram_user_id: telegramUserId,
          event_type: 'INVITE_CREATED',
          actor_type: is_manual ? 'admin' : 'system',
          reason: inviteSource,
          meta: {
            club_id: club.id,
            tg_id: telegramUserId,
            expected_tg_id: telegramUserId,
            invite_link_id: inviteRecord?.id || null,
            invite_code: code,
            target_type: 'chat',
            target_chat_id: club.chat_id,
            member_limit: 1,
            expires_at: now24h,
            source_function: 'telegram-grant-access',
            decision: 'created',
          },
        });
      }

      if (channelInviteLink && club.channel_id) {
        const code = extractInviteCode(channelInviteLink);
        const { data: chInviteRecord } = await supabase.from('telegram_invite_links').insert({
          club_id: club.id,
          profile_id: profile.id,
          telegram_user_id: telegramUserId,
          invite_link: channelInviteLink,
          invite_code: code,
          target_type: 'channel',
          target_chat_id: club.channel_id,
          status: 'sent',
          sent_at: new Date().toISOString(),
          expires_at: now24h,
          member_limit: 1,
          source: inviteSource,
          source_id: source_id || null,
        }).select('id').maybeSingle();

        // v5.3: INVITE_CREATED audit (channel)
        await logAudit(supabase, {
          club_id: club.id,
          user_id: profile.id,
          telegram_user_id: telegramUserId,
          event_type: 'INVITE_CREATED',
          actor_type: is_manual ? 'admin' : 'system',
          reason: inviteSource,
          meta: {
            club_id: club.id,
            tg_id: telegramUserId,
            expected_tg_id: telegramUserId,
            invite_link_id: chInviteRecord?.id || null,
            invite_code: code,
            target_type: 'channel',
            target_chat_id: club.channel_id,
            member_limit: 1,
            expires_at: now24h,
            source_function: 'telegram-grant-access',
            decision: 'created',
          },
        });
      }
      
      await supabase.from('telegram_club_members').update(inviteTrackingUpdate)
        .eq('telegram_user_id', telegramUserId).eq('club_id', club.id);

      // PATCH P0.9.8c-fix: DM text variables (hoisted for log access)
      const dmClubName = club.club_name || 'клуб';
      const dmProductTitle = product_name || dmClubName;
      const dmTariffTitle = tariff_name || null;
      const dmTariffPart = dmTariffTitle ? ` (тариф: ${dmTariffTitle})` : '';

      // Send invite links via bot
      let dmSent = false;
      let dmError: string | undefined;
      let dmText = '';
      // PATCH: scope-fix — переменные для зеркалирования DM в telegram_messages
      // должны быть доступны в нижнем блоке записи telegram_logs (раньше падало
      // с ReferenceError: wasMirroredToMessages is not defined).
      let wasMirroredToMessages = false;
      let mirroredTelegramMessageId: number | null = null;

      if (chatInviteLink || channelInviteLink) {
        const keyboard: { inline_keyboard: Array<Array<{ text: string; url: string }>> } = { inline_keyboard: [] };
        if (chatInviteLink) keyboard.inline_keyboard.push([{ text: '💬 Войти в чат клуба', url: chatInviteLink }]);
        if (channelInviteLink) keyboard.inline_keyboard.push([{ text: '📣 Войти в канал клуба', url: channelInviteLink }]);

        const validUntilText = activeUntil
          ? `\n📅 Доступ активен до: ${new Date(activeUntil).toLocaleDateString('ru-RU')}`
          : '';

        const joinRequestNote = joinRequestMode
          ? '\n\n⏳ <i>После перехода по ссылке Ваша заявка будет автоматически одобрена.</i>'
          : '\n\n⚠️ <i>Ссылки одноразовые — переходите сейчас!</i>';

        // PATCH NAME-V: безопасное обращение по имени, обращение строго на «Вы».
        const dmNamePrefix = greetPrefix(profile);

        // Plain text for logs (no HTML tags)
        dmText = `✅ Доступ открыт!\n\n${dmNamePrefix}Ваш доступ к ${dmProductTitle}${dmTariffPart} активирован.\nКлуб: ${dmClubName}\n\nВот ссылки для входа:${validUntilText.replace(/<[^>]*>/g, '')}${joinRequestNote.replace(/<[^>]*>/g, '')}`;
        // HTML for Telegram
        const dmHtml = `✅ <b>Доступ открыт!</b>\n\n${dmNamePrefix}Ваш доступ к <b>${dmProductTitle}</b>${dmTariffPart} активирован.\nКлуб: <b>${dmClubName}</b>\n\nВот ссылки для входа:${validUntilText}${joinRequestNote}`;

        const result = await sendMessage(
          botToken,
          telegramUserId,
          dmHtml,
          keyboard
        );

        dmSent = result.ok;
        if (!result.ok) dmError = result.description;

        // Mirror to admin chat (Contact Center)
        if (result?.ok && result?.result?.message_id) {
          await logAutomatedTelegramMessage({
            supabase,
            user_id,
            telegram_user_id: telegramUserId,
            bot_id: bot?.id ?? null,
            text: dmText,
            telegram_message_id: result.result.message_id,
            reply_markup: keyboard,
            source: 'telegram-grant-access',
            extra_meta: {
              club_id: club.id,
              source_id: source_id ?? null,
              event: 'access_granted_dm',
              canonical_order_id: canonicalOrderId,
              idempotency_key: canonicalBusinessRef
                ? `access_granted_dm:${user_id}:${club.id}:${canonicalBusinessRef}`
                : undefined,
            },
          });
          mirroredTelegramMessageId = result.result.message_id;
          wasMirroredToMessages = true;
        }

        // Update can_dm status
        const canDm = !result.description?.includes('bot was blocked') && !result.description?.includes("can't initiate");
        await supabase.from('telegram_club_members').update({
        can_dm: canDm,
      }).eq('telegram_user_id', telegramUserId).eq('club_id', club.id);

      // Send custom tariff welcome message and/or GetCourse link (for source_id = order_id)
      if (dmSent && source_id) {
        try {
          // Get order with tariff and offer info
          const { data: orderInfo } = await supabase
            .from('orders_v2')
            .select('tariff_id, meta')
            .eq('id', source_id)
            .maybeSingle();
          
          // Extract offer_id from meta (not a direct column)
          const offerId = (orderInfo?.meta as Record<string, unknown> | null)?.offer_id as string | undefined;
          
          if (orderInfo?.tariff_id) {
            const { data: tariffData } = await supabase
              .from('tariffs')
              .select('meta')
              .eq('id', orderInfo.tariff_id)
              .maybeSingle();
            
            const tariffMeta = tariffData?.meta as Record<string, unknown> | null;
            const welcomeMessage = tariffMeta?.welcome_message as {
              enabled?: boolean;
              text?: string;
              button?: { enabled?: boolean; text?: string; url?: string };
              media?: { type?: string; storage_path?: string };
            } | undefined;
            
            // PATCH 5: offer-first → tariff-fallback → GC link, never two, idempotency
            // 0. Idempotency check: skip if welcome already sent for this source_id
            const { data: existingWelcome } = await supabase
              .from('audit_logs')
              .select('id')
              .eq('action', 'telegram_welcome_sent')
              .eq('actor_label', 'telegram-grant-access')
              .eq('meta->>source_id', source_id)
              .limit(1)
              .maybeSingle();

            if (existingWelcome) {
              console.log(`[telegram-grant-access] Welcome already sent for source_id=${source_id}, skipping`);
            } else {
              let welcomeSent = false;
              let welcomeType = '';

              // 1. OFFER welcome (priority) — only if offerId exists
              if (!welcomeSent && offerId) {
                const { data: offerData } = await supabase
                  .from('tariff_offers')
                  .select('meta')
                  .eq('id', offerId)
                  .maybeSingle();
                
                const offerMeta = offerData?.meta as Record<string, unknown> | null;
                const offerWelcomeMessage = offerMeta?.welcome_message as {
                  enabled?: boolean;
                  text?: string;
                  button?: { enabled?: boolean; text?: string; url?: string };
                  media?: { type?: string; storage_path?: string };
                } | undefined;
                
                if (offerWelcomeMessage?.enabled) {
                  // Send offer media first if present + mirror
                  if (offerWelcomeMessage.media?.type && offerWelcomeMessage.media?.storage_path) {
                    const mediaRes = await sendTariffMedia(supabase, botToken, telegramUserId, offerWelcomeMessage.media);
                    await mirrorWelcomeMedia({
                      supabase, user_id, telegram_user_id: telegramUserId, bot_id: bot?.id ?? null,
                      club_id: club.id, source_id: source_id ?? null,
                      event: 'offer_welcome_media', media_result: mediaRes,
                    });
                  }
                  // Send offer text with optional button — mirror always
                  if (offerWelcomeMessage.text) {
                    const keyboard = offerWelcomeMessage.button?.enabled && offerWelcomeMessage.button.url ? {
                      inline_keyboard: [[{
                        text: offerWelcomeMessage.button.text || 'Открыть',
                        url: offerWelcomeMessage.button.url,
                      }]]
                    } : undefined;
                    const wRes = await sendMessage(botToken, telegramUserId, offerWelcomeMessage.text, keyboard);
                    if (wRes?.ok && wRes?.result?.message_id) {
                      await logAutomatedTelegramMessage({
                        supabase, user_id, telegram_user_id: telegramUserId, bot_id: bot?.id ?? null,
                        text: offerWelcomeMessage.text, telegram_message_id: wRes.result.message_id,
                        reply_markup: keyboard, source: 'telegram-grant-access',
                        extra_meta: { club_id: club.id, source_id: source_id ?? null, event: 'offer_welcome' },
                      });
                    }
                  }
                  welcomeSent = true;
                  welcomeType = 'offer';
                  console.log(`[telegram-grant-access] Sent OFFER welcome for offer ${offerId}`);
                }
              }

              // 2. TARIFF welcome (fallback) — only if offer didn't send
              if (!welcomeSent && welcomeMessage?.enabled) {
                if (welcomeMessage.media?.type && welcomeMessage.media?.storage_path) {
                  const mediaRes = await sendTariffMedia(supabase, botToken, telegramUserId, welcomeMessage.media);
                  await mirrorWelcomeMedia({
                    supabase, user_id, telegram_user_id: telegramUserId, bot_id: bot?.id ?? null,
                    club_id: club.id, source_id: source_id ?? null,
                    event: 'tariff_welcome_media', media_result: mediaRes,
                  });
                }
                if (welcomeMessage.text) {
                  const keyboard = welcomeMessage.button?.enabled && welcomeMessage.button.url ? {
                    inline_keyboard: [[{
                      text: welcomeMessage.button.text || 'Открыть',
                      url: welcomeMessage.button.url,
                    }]]
                  } : undefined;
                  const wRes = await sendMessage(botToken, telegramUserId, welcomeMessage.text, keyboard);
                  if (wRes?.ok && wRes?.result?.message_id) {
                    await logAutomatedTelegramMessage({
                      supabase, user_id, telegram_user_id: telegramUserId, bot_id: bot?.id ?? null,
                      text: welcomeMessage.text, telegram_message_id: wRes.result.message_id,
                      reply_markup: keyboard, source: 'telegram-grant-access',
                      extra_meta: { club_id: club.id, source_id: source_id ?? null, event: 'tariff_welcome' },
                    });
                  }
                }
                welcomeSent = true;
                welcomeType = 'tariff';
                console.log(`[telegram-grant-access] Sent TARIFF welcome (fallback) for tariff ${orderInfo.tariff_id}`);
              }

              // 3. GC fallback DM — REMOVED. No fallback message sent if no welcome configured.
              // Only the main "✅ Доступ открыт" DM is delivered in that case.

              // 4. Log idempotency record
              if (welcomeSent) {
                try {
                  await supabase.from('audit_logs').insert({
                    action: 'telegram_welcome_sent',
                    actor_type: 'system',
                    actor_user_id: null,
                    actor_label: 'telegram-grant-access',
                    target_user_id: user_id,
                    meta: { source_id, welcome_type: welcomeType, offer_id: offerId || null, tariff_id: orderInfo.tariff_id },
                    created_at: new Date().toISOString(),
                  });
                } catch (auditErr) {
                  console.error('[telegram-grant-access] Failed to log welcome audit:', auditErr);
                }
              }
            }
          }
        } catch (gcError) {
          console.error('Error sending welcome message:', gcError);
        }
      }
      }

      // Log audit
      await logAudit(supabase, {
        club_id: club.id,
        user_id,
        telegram_user_id: telegramUserId,
        event_type: 'GRANT',
        actor_type: is_manual ? 'admin' : 'system',
        actor_id: admin_id,
        reason: comment,
        telegram_chat_result: { unbanned: chatUnbanned, invite_link: chatInviteLink },
        telegram_channel_result: { unbanned: channelUnbanned, invite_link: channelInviteLink },
        meta: { dm_sent: dmSent, dm_error: dmError, valid_until: activeUntil, join_request_mode: joinRequestMode },
      });

      // Legacy log - with extended meta for UI display
      // PATCH P0.9.8c: Fix club_name field (was club.name which is undefined)
      const clubName = club.club_name || 'Клуб';
      const accessEndDate = activeUntil 
        ? new Date(activeUntil).toLocaleDateString('ru-RU') 
        : null;
      
      // Build descriptive message for admin chat display
      const grantType = is_manual ? 'Ручная выдача' : 'Авто-выдача';
      const productInfo = product_name || clubName;
      const tariffInfo = tariff_name ? ` тариф ${tariff_name}` : '';
      const dateInfo = accessEndDate ? ` до ${accessEndDate}` : '';
      const logMessage = `🔑 ${grantType} доступа в ${productInfo}${tariffInfo}${dateInfo}`;
      
      await supabase.from('telegram_logs').insert({
        user_id,
        club_id: club.id,
        action: is_manual ? 'MANUAL_GRANT' : 'AUTO_GRANT',
        target: 'both',
        status: (chatInviteLink || channelInviteLink) ? 'ok' : 'partial',
        meta: { 
          chat_invite_link: chatInviteLink, 
          channel_invite_link: channelInviteLink, 
          valid_until: activeUntil,
          club_name: clubName,
          product_name: product_name || null,
          tariff_name: tariff_name || null,
          access_end_date: accessEndDate,
          source,
          source_id,
          dm_sent: dmSent,
          dm_error: dmError || null,
          mirrored_to_telegram_messages: wasMirroredToMessages,
          telegram_message_id: mirroredTelegramMessageId,
        },
        // If the same outgoing DM is mirrored as a blue telegram_messages bubble,
        // do not duplicate it as a grey event-card in Contact Center.
        message_text: wasMirroredToMessages ? null : `[DM не отправлен] ${dmError || 'unknown error'}\n---\n${logMessage}`,
      });

      results.push({
        club_id: club.id,
        chat_invite_link: chatInviteLink,
        channel_invite_link: channelInviteLink,
        dm_sent: dmSent,
      });
    }

    // Sub-patch B: Write ledger entry for grant outcome
    try {
      const hasAnyInvite = results.some((r: any) => r.chat_invite_link || r.channel_invite_link);
      const allSkipped = results.every((r: any) => !r.chat_invite_link && !r.channel_invite_link && !r.error);
      const hasError = results.some((r: any) => r.error);

      let ledgerActionType: string;
      let ledgerStatus: string;

      if (hasAnyInvite) {
        ledgerActionType = 'grant';
        ledgerStatus = 'granted';
      } else if (hasError && !hasAnyInvite) {
        ledgerActionType = 'grant';
        ledgerStatus = 'failed';
      } else {
        // no-op / already linked / no clubs matched
        ledgerActionType = 'skip';
        ledgerStatus = 'skipped';
      }

      const clubIdsList = resolvedClubIds.join(',');
      // Deterministic ledger key — fulfillment-executor rejects timestamp-like numbers.
      const ledgerSubjectRef =
        canonicalBusinessRef || source_id || admin_id || user_id;
      const ledgerSourceTag = source || (is_manual ? 'manual' : 'system');
      const ledgerSourceEventKey = `tg-grant:${ledgerSourceTag}:${ledgerSubjectRef}:${clubIdsList}`;

      const ledgerEntry: LedgerEntry = {
        source_event_type: is_manual ? 'admin' : 'system',
        source_event_key: ledgerSourceEventKey,
        source_subject_type: is_manual ? 'admin_action' : 'subscription',
        source_subject_ref: admin_id || source_id || null,
        action_type: ledgerActionType,
        reason_code: source === 'auto_subscription' ? 'paid_order' : (is_manual ? 'admin_grant' : 'system_grant'),
        target_type: 'club',
        target_key: `${user_id}:${clubIdsList}`,
        target_ref: resolvedClubIds[0] || null,
        user_id: user_id,
        profile_id: profile?.id || null,
        status: ledgerStatus,
        result: {
          clubs_processed: results.length,
          has_invite: hasAnyInvite,
          source: source || (is_manual ? 'manual' : 'system'),
        },
        parent_event_key: parent_event_key || null,
        parent_execution_key: parent_execution_key || null,
      };

      await writeLedgerEntry(supabase, ledgerEntry);
      console.log(`[telegram-grant-access] Ledger: action=${ledgerActionType}, status=${ledgerStatus}, parent=${parent_event_key || 'null'}`);
    } catch (ledgerErr) {
      console.error('[telegram-grant-access] Ledger write error (non-blocking):', ledgerErr);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Grant access error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
