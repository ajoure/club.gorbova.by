import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GrantAccessRequest {
  user_id: string;
  club_id?: string;
  is_manual?: boolean;
  admin_id?: string;
  valid_until?: string;
  comment?: string;
  source?: string;
  source_id?: string;
  tariff_name?: string;      // For logging in telegram chat
  product_name?: string;     // For logging in telegram chat
  duration_days?: number;    // For calculating access end
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
) {
  if (!media.type || !media.storage_path) return;
  
  try {
    // Download from Storage
    const { data, error } = await supabase.storage
      .from('tariff-media')
      .download(media.storage_path);
    
    if (error || !data) {
      console.error('Failed to download tariff media:', error);
      return;
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
    } else {
      console.log('Sent tariff media:', media.type);
    }
  } catch (err) {
    console.error('Error sending tariff media:', err);
  }
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
    const { user_id, club_id, is_manual, admin_id, valid_until, comment, source, source_id, tariff_name, product_name, duration_days } = body;

    console.log('Grant access request:', body);

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
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
      let targetClubId = club_id;
      if (!targetClubId) {
        const { data: defaultClub } = await supabase
          .from('telegram_clubs')
          .select('id')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        targetClubId = defaultClub?.id;
      }

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

    // Get clubs
    let clubsQuery = supabase.from('telegram_clubs').select('*, telegram_bots(*)').eq('is_active', true);
    if (club_id) clubsQuery = clubsQuery.eq('id', club_id);
    const { data: clubs, error: clubsError } = await clubsQuery;

    if (clubsError || !clubs?.length) {
      return new Response(JSON.stringify({ error: 'No active clubs found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    const telegramUserId = Number(profile.telegram_user_id);

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

      // Calculate active_until
      let activeUntil: string | null = valid_until || null;
      if (!activeUntil && !is_manual) {
        // First try subscriptions_v2
        const { data: subV2 } = await supabase
          .from('subscriptions_v2')
          .select('access_end_at')
          .eq('user_id', user_id)
          .in('status', ['active', 'trial'])
          .order('access_end_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (subV2?.access_end_at) {
          activeUntil = subV2.access_end_at;
        } else {
          // Fallback to legacy subscriptions table
          const { data: subscription } = await supabase
            .from('subscriptions')
            .select('expires_at')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .single();
          activeUntil = subscription?.expires_at || null;
        }
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
          .select('id')
          .eq('user_id', user_id)
          .eq('club_id', club.id)
          .eq('source_id', source_id)
          .maybeSingle();
        
        if (existingGrant) {
          console.log(`[grant-access] Skip duplicate grant for source_id=${source_id}, existing grant=${existingGrant.id}`);
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
      }

      if (channelInviteLink && club.channel_id) {
        const code = extractInviteCode(channelInviteLink);
        await supabase.from('telegram_invite_links').insert({
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

      if (chatInviteLink || channelInviteLink) {
        const keyboard: { inline_keyboard: Array<Array<{ text: string; url: string }>> } = { inline_keyboard: [] };
        if (chatInviteLink) keyboard.inline_keyboard.push([{ text: '💬 Войти в чат клуба', url: chatInviteLink }]);
        if (channelInviteLink) keyboard.inline_keyboard.push([{ text: '📣 Войти в канал клуба', url: channelInviteLink }]);

        const validUntilText = activeUntil
          ? `\n📅 Доступ активен до: ${new Date(activeUntil).toLocaleDateString('ru-RU')}`
          : '';

        const joinRequestNote = joinRequestMode
          ? '\n\n⏳ <i>После перехода по ссылке твоя заявка будет автоматически одобрена.</i>'
          : '\n\n⚠️ <i>Ссылки одноразовые — переходи сейчас!</i>';

        // Plain text for logs (no HTML tags)
        dmText = `✅ Доступ открыт!\n\nТвой доступ к ${dmProductTitle}${dmTariffPart} активирован.\nКлуб: ${dmClubName}\n\nВот ссылки для входа:${validUntilText.replace(/<[^>]*>/g, '')}${joinRequestNote.replace(/<[^>]*>/g, '')}`;
        // HTML for Telegram
        const dmHtml = `✅ <b>Доступ открыт!</b>\n\nТвой доступ к <b>${dmProductTitle}</b>${dmTariffPart} активирован.\nКлуб: <b>${dmClubName}</b>\n\nВот ссылки для входа:${validUntilText}${joinRequestNote}`;

        const result = await sendMessage(
          botToken,
          telegramUserId,
          dmHtml,
          keyboard
        );

        dmSent = result.ok;
        if (!result.ok) dmError = result.description;

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
              .select('getcourse_offer_id, meta')
              .eq('id', orderInfo.tariff_id)
              .maybeSingle();
            
            const tariffMeta = tariffData?.meta as Record<string, unknown> | null;
            const welcomeMessage = tariffMeta?.welcome_message as {
              enabled?: boolean;
              text?: string;
              button?: { enabled?: boolean; text?: string; url?: string };
              media?: { type?: string; storage_path?: string };
            } | undefined;
            
            // 1. Send TARIFF welcome message if configured
            if (welcomeMessage?.enabled) {
              // Send media first if present
              if (welcomeMessage.media?.type && welcomeMessage.media?.storage_path) {
                await sendTariffMedia(supabase, botToken, telegramUserId, welcomeMessage.media);
              }
              
              // Send text with optional button
              if (welcomeMessage.text) {
                const keyboard = welcomeMessage.button?.enabled && welcomeMessage.button.url ? {
                  inline_keyboard: [[{
                    text: welcomeMessage.button.text || 'Открыть',
                    url: welcomeMessage.button.url,
                  }]]
                } : undefined;
                
                await sendMessage(botToken, telegramUserId, welcomeMessage.text, keyboard);
                console.log('Sent tariff welcome message to user', telegramUserId);
              }
            }
            
            // 2. Send OFFER welcome message if configured (additional message)
            let offerWelcomeEnabled = false;
            if (offerId) {
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
              
              offerWelcomeEnabled = !!offerWelcomeMessage?.enabled;
              
              if (offerWelcomeMessage?.enabled) {
                // Send offer media first if present
                if (offerWelcomeMessage.media?.type && offerWelcomeMessage.media?.storage_path) {
                  await sendTariffMedia(supabase, botToken, telegramUserId, offerWelcomeMessage.media);
                }
                
                // Send offer text with optional button
                if (offerWelcomeMessage.text) {
                  const keyboard = offerWelcomeMessage.button?.enabled && offerWelcomeMessage.button.url ? {
                    inline_keyboard: [[{
                      text: offerWelcomeMessage.button.text || 'Открыть',
                      url: offerWelcomeMessage.button.url,
                    }]]
                  } : undefined;
                  
                  await sendMessage(botToken, telegramUserId, offerWelcomeMessage.text, keyboard);
                  console.log('Sent offer welcome message to user', telegramUserId);
                }
              }
            }
            
            // Send GetCourse link ONLY if NEITHER tariff NOR offer have welcome messages enabled
            const gcUrl = tariffMeta?.getcourse_lesson_url as string | undefined;
            const getcourseOfferId = tariffData?.getcourse_offer_id;
            
            if (!welcomeMessage?.enabled && !offerWelcomeEnabled && (getcourseOfferId || gcUrl)) {
              const gcMessage = 
                `📚 Материалы доступны на GetCourse.\n\n` +
                `Письмо с доступом придёт на email в течение ~5 минут.\n\n` +
                (gcUrl ? `Ссылка: ${gcUrl}` : 'https://gorbova.getcourse.ru/teach');
              
              await sendMessage(botToken, telegramUserId, gcMessage);
              console.log('Sent GetCourse link message to user', telegramUserId);
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
        },
        // PATCH P0.9.8c-fix: Store actual DM text (plain), only if sent successfully
        message_text: dmSent ? dmText : `[DM не отправлен] ${dmError || 'unknown error'}\n---\n${logMessage}`,
      });

      results.push({
        club_id: club.id,
        chat_invite_link: chatInviteLink,
        channel_invite_link: channelInviteLink,
        dm_sent: dmSent,
      });
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
