import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSystemTokens, extractUsedTokens } from '../_shared/systemTokens.ts';
import { resolveCustomFieldTokens, extractCustomFieldTokenIds } from '../_shared/customFieldTokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function telegramUploadMedia(
  botToken: string,
  method: string,
  chatId: string | number,
  mediaType: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  caption?: string,
  keyboard?: unknown
) {
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  
  const blob = new Blob([fileBuffer]);
  formData.append(mediaType, blob, fileName);
  
  if (caption) {
    formData.append('caption', caption);
    formData.append('parse_mode', 'Markdown');
  }
  
  if (keyboard) {
    formData.append('reply_markup', JSON.stringify(keyboard));
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

interface AudienceRule {
  product_id?: string;
  tariff_ids?: string[];
  mode?: 'purchased' | 'active_access';
}

interface BroadcastFilters {
  // Legacy
  hasActiveSubscription?: boolean;
  productId?: string;
  productIds?: string[];
  tariffId?: string;
  tariffIds?: string[];
  clubId?: string;
  // New schema
  include?: AudienceRule[];
  exclude?: AudienceRule[];
  club_ids?: string[];
  club_membership?: 'current' | 'ever' | 'any';
  bot_ids?: string[];
  channel?: 'telegram' | 'email' | 'any';
}

/**
 * Resolve standard contact tokens in a message template.
 */
function resolveContactTokens(
  text: string,
  profile: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; telegram_username?: string | null }
): string {
  if (!text.includes('{{')) return text;
  
  const fullName = profile.full_name || '';
  const parts = fullName.split(/\s+/);
  const firstName = profile.first_name || parts[0] || '';
  const lastName = profile.last_name || parts.slice(1).join(' ') || '';

  return text
    .replace(/\{\{full_name\}\}/g, fullName)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{email\}\}/g, profile.email || '')
    .replace(/\{\{phone\}\}/g, profile.phone || '')
    .replace(/\{\{telegram_username\}\}/g, profile.telegram_username || '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // NOTE: this 'supabase' is a SERVICE_ROLE client (RLS bypass).
    // Required by resolveCustomFieldTokens and direct table queries.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify admin authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request - support both JSON and FormData
    let message = '';
    let includeButton = false;
    let buttonText = '';
    let buttonUrl = '';
    let filters: BroadcastFilters = {};
    let mediaType: string | null = null;
    let mediaBuffer: ArrayBuffer | null = null;
    let mediaFileName: string | null = null;
    let productContextId: string | null = null;
    let templateType: string | null = null;
    let liveEventId: string | null = null;

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      message = formData.get('message') as string || '';
      includeButton = formData.get('include_button') === 'true';
      buttonText = formData.get('button_text') as string || '';
      buttonUrl = formData.get('button_url') as string || '';
      
      const filtersStr = formData.get('filters') as string;
      if (filtersStr) {
        filters = JSON.parse(filtersStr);
      }
      
      const rawPcid = formData.get('product_context_id') as string;
      productContextId = (rawPcid && rawPcid !== 'all') ? rawPcid : null;
      
      mediaType = formData.get('media_type') as string || null;
      const mediaFile = formData.get('media') as File | null;
      
      if (mediaFile) {
        mediaBuffer = await mediaFile.arrayBuffer();
        mediaFileName = mediaFile.name;
      }

      templateType = formData.get('template_type') as string || null;
      liveEventId = formData.get('live_event_id') as string || null;
    } else {
      const body = await req.json();
      message = body.message || '';
      includeButton = body.include_button || false;
      buttonText = body.button_text || '';
      buttonUrl = body.button_url || '';
      filters = body.filters || {};
      const rawPcid = body.product_context_id;
      productContextId = (rawPcid && rawPcid !== 'all') ? rawPcid : null;
      templateType = body.template_type || null;
      liveEventId = body.live_event_id || null;
    }

    const isWebinarInvite = templateType === 'webinar_invite' && !!liveEventId;

    if (!message && !mediaBuffer) {
      return new Response(
        JSON.stringify({ error: 'Message or media is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting mass broadcast...', { filters, hasMedia: !!mediaBuffer, mediaType, productContextId });

    // Resolve audience via canonical RPC (supports include/exclude/clubs/channel)
    const useNewSchema = Array.isArray(filters.include) || Array.isArray(filters.exclude) || Array.isArray(filters.club_ids);

    let allowedUserIds: Set<string> | null = null;

    if (useNewSchema) {
      const rpcFilters = {
        include: filters.include || [],
        exclude: filters.exclude || [],
        club_ids: filters.club_ids || [],
        club_membership: filters.club_membership || 'any',
        channel: 'telegram',
      };
      // Use a user-scoped client so auth.uid() works inside the SECURITY DEFINER RPC
      // (which checks has_permission(auth.uid(), 'entitlements.manage')).
      // Admin permission has already been verified above.
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: audience, error: rpcErr } = await userClient.rpc('resolve_broadcast_audience_user_ids', { _filters: rpcFilters });
      if (rpcErr) {
        console.error('[broadcast] resolve_broadcast_audience_user_ids failed:', rpcErr);
        return new Response(
          JSON.stringify({ error: `Audience resolution failed: ${rpcErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      allowedUserIds = new Set((audience || []).filter((r: { has_telegram: boolean }) => r.has_telegram).map((r: { user_id: string }) => r.user_id));
    }

    // Build user query (include telegram_link_bot_id for per-bot segmentation)
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('user_id, telegram_user_id, telegram_link_bot_id, full_name, first_name, last_name, email, phone, telegram_username')
      .not('telegram_user_id', 'is', null)
      .limit(10000);

    if (!allProfiles?.length) {
      return new Response(
        JSON.stringify({ error: 'No users with Telegram found', sent: 0, failed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let profiles = allProfiles;

    if (useNewSchema && allowedUserIds) {
      profiles = profiles.filter(p => allowedUserIds!.has(p.user_id));
    } else {
      // ===== Legacy filter path (kept for backward compat) =====
      if (filters.hasActiveSubscription) {
        const { data: activeSubs } = await supabase
          .from('subscriptions_v2')
          .select('user_id')
          .eq('status', 'active');
        const activeUserIds = new Set(activeSubs?.map(s => s.user_id) || []);
        profiles = profiles.filter(p => activeUserIds.has(p.user_id));
      }

      const effectiveProductIds = filters.productIds?.length ? filters.productIds : (filters.productId ? [filters.productId] : []);
      const effectiveTariffIds = filters.tariffIds?.length ? filters.tariffIds : (filters.tariffId ? [filters.tariffId] : []);

      if (effectiveProductIds.length > 0) {
        let subQuery = supabase
          .from('subscriptions_v2')
          .select('user_id')
          .in('product_id', effectiveProductIds)
          .eq('status', 'active');
        if (effectiveTariffIds.length > 0) {
          subQuery = subQuery.in('tariff_id', effectiveTariffIds);
        }
        const { data: productSubs } = await subQuery;
        const productUserIds = new Set(productSubs?.map(s => s.user_id) || []);
        profiles = profiles.filter(p => productUserIds.has(p.user_id));
      }

      if (filters.clubId) {
        const { data: clubAccess } = await supabase
          .from('telegram_access')
          .select('user_id')
          .eq('club_id', filters.clubId)
          .or('active_until.is.null,active_until.gt.now()');
        const clubUserIds = new Set(clubAccess?.map(a => a.user_id) || []);
        profiles = profiles.filter(p => clubUserIds.has(p.user_id));
      }
    }

    // Always include administrators
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');
    
    const adminUserIds = new Set(adminRoles?.map(r => r.user_id) || []);
    
    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('user_id, telegram_user_id, telegram_link_bot_id, full_name, first_name, last_name, email, phone, telegram_username')
      .not('telegram_user_id', 'is', null)
      .in('user_id', [...adminUserIds]);
    
    const existingUserIds = new Set(profiles.map(p => p.user_id));
    for (const adminProfile of (adminProfiles || [])) {
      if (!existingUserIds.has(adminProfile.user_id)) {
        profiles.push(adminProfile);
        existingUserIds.add(adminProfile.user_id);
      }
    }

    console.log(`Found ${profiles.length} matching profiles (including admins)`);

    // ===== Resolve target bots (respect filters.bot_ids) =====
    // Load all active bots (we'll filter below)
    const { data: allActiveBots, error: botsError } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, bot_token_encrypted, is_primary, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (botsError || !allActiveBots?.length) {
      console.error('No active bot found', botsError);
      return new Response(
        JSON.stringify({ error: 'No active bot found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine primary bot: prefer is_primary, fallback to first by created_at
    const primaryBot = allActiveBots.find((b) => b.is_primary) || allActiveBots[0];
    const primaryBotId: string = primaryBot.id;

    // Selected bots: bot_ids non-empty -> use those; empty -> primary only
    const selectedBotIds: string[] = (filters.bot_ids && filters.bot_ids.length > 0)
      ? filters.bot_ids
      : [primaryBotId];

    const targetBots = allActiveBots.filter((b) => selectedBotIds.includes(b.id));
    if (targetBots.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Selected bots are not active', selected_bot_ids: selectedBotIds }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const includesPrimary = targetBots.some((b) => b.id === primaryBotId);
    console.log('[broadcast] bot routing', {
      primary_bot_id: primaryBotId,
      selected_bot_ids: selectedBotIds,
      target_bots: targetBots.map((b) => ({ id: b.id, username: b.bot_username })),
      includes_primary: includesPrimary,
    });

    const appUrl = buttonUrl || Deno.env.get('APP_URL') || 'https://app.example.com';


    // Per-bot statistics
    interface PerBotStat {
      bot_id: string;
      bot_username: string;
      total_candidates: number;
      sent: number;
      failed: number;
      skipped_duplicate: number;
    }
    const perBotStats: Record<string, PerBotStat> = {};
    for (const b of targetBots) {
      perBotStats[b.id] = {
        bot_id: b.id,
        bot_username: b.bot_username,
        total_candidates: 0,
        sent: 0,
        failed: 0,
        skipped_duplicate: 0,
      };
    }

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkippedNoMatchingBot = 0;
    let totalSkippedDuplicate = 0;

    // Dedup: one user_id receives the message at most once per broadcast
    const sentToUserIds = new Set<string>();

    const messageLogBatch: Array<{
      user_id: string;
      telegram_user_id: number;
      bot_id: string | null;
      direction: string;
      message_text: string;
      message_id: number | null;
      sent_by_admin: string;
      status: string;
      meta: Record<string, unknown>;
    }> = [];

    const baseKeyboard = includeButton && !isWebinarInvite ? {
      inline_keyboard: [[
        { text: buttonText || 'Открыть платформу', url: appUrl }
      ]]
    } : undefined;

    // For webinar_invite, determine origin for personal links
    const appOrigin = Deno.env.get('APP_URL') || Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '') || 'https://gorbova.lovable.app';

    // Extract token usage from original template (before substitution)
    const tokensInfo = extractUsedTokens(message);
    const cfFieldIds = extractCustomFieldTokenIds(message);
    // Single `now` for the entire broadcast
    const broadcastNow = new Date();

    // Resolve cf tokens once (same product for all recipients)
    let cfTokensIgnored = false;
    let messageAfterCf = message;
    if (cfFieldIds.length > 0) {
      const cfResult = await resolveCustomFieldTokens(message, productContextId, supabase);
      messageAfterCf = cfResult.text;
      cfTokensIgnored = cfResult.cfTokensIgnored;
    }

    // Helper: generate personal invite token via live-token-validate
    async function createInviteToken(userId: string, eventId: string): Promise<{ token: string; link_id: string } | null> {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const response = await fetch(`${supabaseUrl}/functions/v1/live-token-validate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
            'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create',
            live_event_id: eventId,
            user_id: userId,
            sent_via: 'telegram',
          }),
        });
        const data = await response.json();
        if (data.status === 'ok') {
          return { token: data.token, link_id: data.link_id };
        }
        console.error(`[broadcast] Token create failed for user ${userId}:`, data);
        return null;
      } catch (e) {
        console.error(`[broadcast] Token create error for user ${userId}:`, e);
        return null;
      }
    }

    // ===== Audience segmentation by telegram_link_bot_id =====
    // Map: bot_id -> profiles[] that should receive via THIS bot
    const profilesByBot: Record<string, typeof profiles> = {};
    for (const b of targetBots) profilesByBot[b.id] = [];

    for (const p of profiles) {
      const linkBotId = p.telegram_link_bot_id as string | null;
      if (linkBotId && selectedBotIds.includes(linkBotId)) {
        // User is bound to one of the selected bots → route there
        profilesByBot[linkBotId].push(p);
      } else if (!linkBotId) {
        // Unknown link → only via primary, and only if primary is among selected
        if (includesPrimary) {
          profilesByBot[primaryBotId].push(p);
        } else {
          totalSkippedNoMatchingBot++;
        }
      } else {
        // User bound to a bot that is NOT selected → skip
        totalSkippedNoMatchingBot++;
      }
    }

    for (const b of targetBots) {
      perBotStats[b.id].total_candidates = profilesByBot[b.id].length;
    }

    console.log('[broadcast] segmentation', {
      per_bot_candidates: Object.fromEntries(targetBots.map((b) => [b.bot_username, profilesByBot[b.id].length])),
      skipped_no_matching_bot: totalSkippedNoMatchingBot,
    });

    // ===== Outer loop: bots; inner loop: profiles =====
    for (const bot of targetBots) {
      const botToken = bot.bot_token_encrypted;
      const botId = bot.id;
      const botProfiles = profilesByBot[botId];

      for (const profile of botProfiles) {
        // Dedup guard
        if (sentToUserIds.has(profile.user_id)) {
          perBotStats[botId].skipped_duplicate++;
          totalSkippedDuplicate++;
          continue;
        }

        const afterContact = resolveContactTokens(messageAfterCf, profile);
        const personalizedMessage = resolveSystemTokens(afterContact, broadcastNow);
        try {
          let keyboard = baseKeyboard;
          let inviteLinkId: string | null = null;

          if (isWebinarInvite && liveEventId) {
            const tokenResult = await createInviteToken(profile.user_id, liveEventId);
            if (tokenResult) {
              const personalUrl = `${appOrigin}/live-access/${tokenResult.token}`;
              inviteLinkId = tokenResult.link_id;
              keyboard = {
                inline_keyboard: [[
                  { text: buttonText || 'Смотреть эфир', url: personalUrl }
                ]]
              };
            } else {
              perBotStats[botId].failed++;
              totalFailed++;
              console.error(`[broadcast] Skipping ${profile.user_id}: token generation failed`);
              continue;
            }
          }

          let result;

          if (mediaBuffer && mediaType && mediaFileName) {
            let method: string;
            let mediaField: string;

            switch (mediaType) {
              case 'photo': method = 'sendPhoto'; mediaField = 'photo'; break;
              case 'video': method = 'sendVideo'; mediaField = 'video'; break;
              case 'audio': method = 'sendAudio'; mediaField = 'audio'; break;
              case 'video_note': method = 'sendVideoNote'; mediaField = 'video_note'; break;
              default: method = 'sendDocument'; mediaField = 'document';
            }

            result = await telegramUploadMedia(
              botToken,
              method,
              profile.telegram_user_id,
              mediaField,
              mediaBuffer,
              mediaFileName,
              personalizedMessage || undefined,
              keyboard
            );
          } else {
            result = await telegramRequest(botToken, 'sendMessage', {
              chat_id: profile.telegram_user_id,
              text: personalizedMessage,
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            });
          }

          if (result.ok) {
            perBotStats[botId].sent++;
            totalSent++;
            sentToUserIds.add(profile.user_id);
            const telegramMsgId = result.result?.message_id || null;
            const msgMeta: Record<string, unknown> = { broadcast: true, bot_username: bot.bot_username };
            if (inviteLinkId) {
              msgMeta.link_id = inviteLinkId;
              msgMeta.live_event_id = liveEventId;
              await supabase.from('live_access_links')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', inviteLinkId)
                .eq('status', 'created');
              await supabase.from('audit_logs').insert({
                action: 'live_link_sent',
                actor_type: 'system',
                actor_label: 'telegram-mass-broadcast',
                meta: { link_id: inviteLinkId, sent_via: 'telegram', user_id: profile.user_id, template_id: null },
              });
            }
            messageLogBatch.push({
              user_id: profile.user_id,
              telegram_user_id: profile.telegram_user_id,
              bot_id: botId,
              direction: 'outgoing',
              message_text: personalizedMessage,
              message_id: telegramMsgId,
              sent_by_admin: user.id,
              status: 'sent',
              meta: msgMeta,
            });
            if (messageLogBatch.length >= 50) {
              await supabase.from('telegram_messages').insert(messageLogBatch.splice(0, 50));
            }
          } else {
            perBotStats[botId].failed++;
            totalFailed++;
            console.error(`Failed to send to ${profile.user_id} via ${bot.bot_username}:`, result.description);
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          perBotStats[botId].failed++;
          totalFailed++;
          console.error(`Error sending to ${profile.user_id} via ${bot.bot_username}:`, error);
        }
      }
    }

    // Flush remaining message logs
    if (messageLogBatch.length > 0) {
      await supabase.from('telegram_messages').insert(messageLogBatch);
    }

    // Log the broadcast action
    await supabase.from('telegram_logs').insert({
      action: 'MASS_NOTIFICATION',
      target: `${sent}/${sent + failed} users`,
      status: failed === 0 ? 'ok' : 'partial',
      message_text: message || null,
      meta: {
        total_users: sent + failed,
        sent,
        failed,
        has_media: !!mediaBuffer,
        media_type: mediaType,
        filters,
      },
    });

    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'telegram_mass_broadcast',
      meta: {
        sent,
        failed,
        total: sent + failed,
        message_preview: resolveSystemTokens(message, broadcastNow)
          .replace(/[,\s]*\{\{(?:first_name|last_name|full_name|name|email|phone|telegram_username)\}\}[,\s]*/g, ' ')
          .replace(/\{\{cf\.product\.[^}]+\}\}/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .substring(0, 80),
        message_template: message,
        template_type: templateType || 'general',
        live_event_id: liveEventId || null,
        include_button: includeButton,
        button_text: includeButton ? (buttonText || 'Открыть платформу') : null,
        // For webinar_invite, don't store button_url in audit (it's per-recipient)
        button_url: (includeButton && !isWebinarInvite) ? appUrl : null,
        has_media: !!mediaBuffer,
        media_type: mediaType,
        filters,
        tokens_used_contact: tokensInfo.contact,
        tokens_used_system: tokensInfo.system,
        tokens_used_cf_ids: cfFieldIds,
        cf_product_id: productContextId,
        cf_tokens_ignored: cfTokensIgnored,
      },
    });

    console.log(`Broadcast complete: sent=${sent}, failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Mass broadcast error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
