import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';
import { checkMonthPurchase, isValidMonthKey } from '../_shared/check-month-purchase.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AccessRule {
  mode: 'all' | 'product' | 'tariff';
  product_id: string | null;
  tariff_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');

    if (!slug) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'slug is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Find event by slug
    const { data: event, error: eventError } = await supabase
      .from('live_events')
      .select('id, slug, title, description, kinescope_video_id, product_id, access_rule, status, is_published, scheduled_at, replay_enabled, invite_mode, direct_access_allowed, event_type, source_kind, event_timezone, platform_status, kinescope_live_event_id, metadata, room_state, room_opened_at, live_started_at, webinar_completed_at')
      .eq('slug', slug)
      .maybeSingle();

    if (eventError) {
      console.error('[live-resolve] DB error:', eventError);
      return jsonRes({ status: 'error', message: 'Internal error' }, 500);
    }

    if (!event) {
      await logAudit(supabase, 'live_access_not_found', null, slug, null);
      return jsonRes({ status: 'not_found' }, 404);
    }

    if (!event.is_published) {
      await logAudit(supabase, 'live_access_unpublished', null, slug, event.id);
      return jsonRes({ status: 'unpublished' }, 403);
    }

    // Guard: live_stream with missing/broken provider source
    if (event.event_type === 'live_stream') {
      const meta = event.metadata as Record<string, any> | null;
      const providerSourceStatus = meta?.provider_source_status;
      if (providerSourceStatus === 'missing' || providerSourceStatus === 'broken') {
        await logAudit(supabase, 'live_access_source_unavailable', null, slug, event.id, {
          provider_source_status: providerSourceStatus,
        });
        return jsonRes({
          status: 'source_unavailable',
          title: event.title,
          description: event.description,
          event_status: event.status,
        }, 503);
      }
    }

    // 3. Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await logAudit(supabase, 'live_access_attempt', null, slug, event.id, { reason: 'no_auth_header' });
      return jsonRes({ status: 'auth_required' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);

    if (authError || !claimsData?.claims?.sub) {
      console.error('[live-resolve] auth error:', authError);
      await logAudit(supabase, 'live_access_attempt', null, slug, event.id, { reason: 'invalid_token' });
      return jsonRes({ status: 'auth_required' }, 401);
    }

    const userId = claimsData.claims.sub;

    // 4. Invite mode check — require proof for required_one_time
    if (event.invite_mode === 'required_one_time' && !event.direct_access_allowed) {
      // Check proof
      const { data: proof } = await supabase
        .from('live_access_proofs')
        .select('id, expires_at')
        .eq('user_id', userId)
        .eq('live_event_id', event.id)
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (!proof) {
        await logAudit(supabase, 'live_access_denied', userId, slug, event.id, {
          reason: 'invite_required',
          invite_mode: event.invite_mode,
        });
        return jsonRes({
          status: 'invite_required',
          title: event.title,
          description: event.description,
          event_status: event.status,
        }, 403);
      }

      // Check active session — session is created ONLY in live-token-validate
      // live-resolve only verifies its existence
      const { data: activeSession } = await supabase
        .from('live_active_sessions')
        .select('id, expires_at')
        .eq('user_id', userId)
        .eq('live_event_id', event.id)
        .is('revoked_at', null)
        .maybeSingle();

      if (!activeSession || new Date(activeSession.expires_at) < new Date()) {
        // Proof valid but no active session — client must re-enter via token-link
        // MVP: frontend maps this to session_expired overlay
        await logAudit(supabase, 'live_access_denied', userId, slug, event.id, {
          reason: 'session_missing',
          proof_id: proof.id,
        });
        return jsonRes({
          status: 'session_missing',
          title: event.title,
          description: event.description,
          event_status: event.status,
        }, 403);
      }
    }

    // 5. Canonical access check — admin bypass + multi-rule model with legacy fallback
    let accessValid = false;

    // Admin bypass — admins and super_admins get unconditional access
    const { data: isAdmin } = await supabase.rpc('has_role_v2', {
      _user_id: userId,
      _role_code: 'admin',
    });
    const { data: isSuperAdmin } = await supabase.rpc('has_role_v2', {
      _user_id: userId,
      _role_code: 'super_admin',
    });
    if (isAdmin === true || isSuperAdmin === true) {
      accessValid = true;
    }

    if (!accessValid) {
      // Try new multi-rule table first
      const { data: accessRules } = await supabase
        .from('live_event_access_rules')
        .select('id, product_id, tariff_id, conditions')
        .eq('live_event_id', event.id);

      // Month-gate context: derived from event.metadata.content_month
      const eventMeta = (event.metadata || {}) as Record<string, any>;
      const eventContentMonth: string | null = isValidMonthKey(eventMeta.content_month)
        ? eventMeta.content_month
        : null;

      // Dedup audit: one month-gate verdict per request
      let monthGateAudited = false;
      const auditMonthGate = async (
        passed: boolean,
        ruleId: string,
        extra: Record<string, any> = {},
      ) => {
        if (monthGateAudited) return;
        monthGateAudited = true;
        await logAudit(
          supabase,
          passed ? 'access.month_gate_passed' : 'access.month_gate_blocked',
          userId,
          slug,
          event.id,
          {
            rule_id: ruleId,
            content_month: eventContentMonth,
            ...extra,
          },
        );
      };

      if (accessRules && accessRules.length > 0) {
        for (const rule of accessRules) {
          const snapshot = await resolveEffectiveProductAccess(supabase, userId, rule.product_id);
          let productOk = false;
          if (snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > new Date())) {
            productOk = true;
          }

          if (productOk && rule.tariff_id) {
            const { data: tariffSub } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .eq('user_id', userId)
              .eq('product_id', rule.product_id)
              .eq('tariff_id', rule.tariff_id)
              .in('status', ['active', 'trial'])
              .limit(1)
              .maybeSingle();

            if (!tariffSub) {
              productOk = false;
            }
          }

          // Month-gate: применяется только при явном флаге в conditions
          if (productOk) {
            const ruleConditions = (rule.conditions || {}) as Record<string, any>;
            const monthGateEnabled = ruleConditions.match_purchase_month === true;

            if (monthGateEnabled) {
              if (!eventContentMonth) {
                // Флаг включён, но у события нет content_month — gate пропускает
                // (нечего сверять). Явный аудит для прозрачности.
                await auditMonthGate(true, rule.id, {
                  skip_reason: 'event_has_no_content_month',
                });
              } else {
                const monthCheck = await checkMonthPurchase(supabase, {
                  user_id: userId,
                  tariff_id: rule.tariff_id ?? null,
                  month: eventContentMonth,
                });
                if (!monthCheck.passed) {
                  productOk = false;
                  await auditMonthGate(false, rule.id, {
                    reason: monthCheck.reason,
                    tariff_id: rule.tariff_id,
                  });
                  continue; // пробуем следующее правило
                } else {
                  await auditMonthGate(true, rule.id, {
                    tariff_id: rule.tariff_id,
                  });
                }
              }
            }
          }

          if (productOk) {
            accessValid = true;
            break;
          }
        }
      } else {
        // Legacy fallback: use access_rule from event
        const accessRule = event.access_rule as AccessRule;

        if (accessRule.mode === 'all') {
          accessValid = true;
        } else {
          const productId = accessRule.product_id || event.product_id;
          if (productId) {
            const snapshot = await resolveEffectiveProductAccess(supabase, userId, productId);

            if (snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > new Date())) {
              accessValid = true;
            }

            if (accessValid && accessRule.mode === 'tariff' && accessRule.tariff_id) {
              const { data: tariffSub } = await supabase
                .from('subscriptions_v2')
                .select('id')
                .eq('user_id', userId)
                .eq('product_id', productId)
                .eq('tariff_id', accessRule.tariff_id)
                .in('status', ['active', 'trial'])
                .limit(1)
                .maybeSingle();

              if (!tariffSub) {
                const { data: tariffEnt } = await supabase
                  .from('entitlements')
                  .select('id')
                  .eq('user_id', userId)
                  .eq('product_id', productId)
                  .eq('status', 'active')
                  .limit(1)
                  .maybeSingle();

                if (!tariffEnt) {
                  accessValid = false;
                }
              }
            }
          }
        }
      }
    }

    if (!accessValid) {
      await logAudit(supabase, 'live_access_denied', userId, slug, event.id, {
        product_id: event.product_id,
      });
      return jsonRes({
        status: 'access_denied',
        title: event.title,
        description: event.description,
        event_status: event.status,
      }, 403);
    }

    // 5b. Moderation overlay — check if user is removed/banned from room
    const { data: isRemoved } = await supabase.rpc('is_user_removed_from_room', {
      _user_id: userId,
      _live_event_id: event.id,
    });

    if (isRemoved === true) {
      await logAudit(supabase, 'live_access_denied', userId, slug, event.id, {
        reason: 'removed_from_room',
      });
      return jsonRes({
        status: 'removed_from_room',
        title: event.title,
        description: event.description,
        event_status: event.status,
      }, 403);
    }

    // 6. Resolve video source — unified server-side resolver
    const resolvedSource = resolveVideoSource(event);

    // Sprint 2 PATCH 2.5: room phase derived from room_state (explicit, не косвенно через platform_status)
    const roomState = (event.room_state ?? 'closed') as 'closed' | 'opened' | 'live' | 'completed';
    let roomPhase: 'closed' | 'waiting' | 'live' | 'completed';
    switch (roomState) {
      case 'opened': roomPhase = 'waiting'; break;
      case 'live': roomPhase = 'live'; break;
      case 'completed': roomPhase = 'completed'; break;
      default: roomPhase = 'closed';
    }

    // Sprint 2 PATCH 2.6: active participants v1 (view: live_event_active_participants_v)
    let activeParticipants = 0;
    try {
      const { data: ap } = await supabase
        .from('live_event_active_participants_v')
        .select('active_count')
        .eq('live_event_id', event.id)
        .maybeSingle();
      activeParticipants = ((ap as any)?.active_count as number) ?? 0;
    } catch (e) {
      console.warn('[live-resolve] active_participants fetch failed:', e);
    }

    // 7. Access granted
    await logAudit(supabase, 'live_access_granted', userId, slug, event.id, {
      product_id: event.product_id,
      room_state: roomState,
      room_phase: roomPhase,
    });

    return jsonRes({
      status: 'ok',
      title: event.title,
      description: event.description,
      kinescope_video_id: event.kinescope_video_id,
      event_status: event.platform_status,
      scheduled_at: event.scheduled_at,
      replay_enabled: event.replay_enabled,
      event_id: event.id,
      event_type: event.event_type,
      source_kind: event.source_kind,
      event_timezone: event.event_timezone,
      platform_status: event.platform_status,
      kinescope_live_event_id: event.kinescope_live_event_id,
      resolved_source: resolvedSource,
      // Sprint 2 PATCH 2.4 / 2.5 / 2.6: room lifecycle SoT в payload (add-only)
      room_state: roomState,
      room_phase: roomPhase,
      room_opened_at: event.room_opened_at,
      live_started_at: event.live_started_at,
      webinar_completed_at: event.webinar_completed_at,
      active_participants: activeParticipants,
      // UX-only metadata pass-through (Sprint 1) — does NOT influence access/resolver logic.
      room_theme: (event.metadata as any)?.room_theme || null,
      live_badge_mode: (event.metadata as any)?.live_badge_mode || null,
      presenter_user_id: (event.metadata as any)?.presenter_user_id || null,
      // Запуск 2: room_settings pass-through (entry/prestart/participants/chat/reactions/sales).
      // UX-only — не влияет на access/resolver. SoT остаётся live_events.metadata.room_settings.
      room_settings: (event.metadata as any)?.room_settings || null,
    });
  } catch (err) {
    console.error('[live-resolve] Unexpected error:', err);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});

// autoCreateSession removed — sessions are created ONLY in live-token-validate

interface ResolvedSource {
  resolved_source_kind: 'kinescope_video' | 'kinescope_live_embed' | 'live_pending' | 'none';
  resolved_embed_url: string | null;
  resolved_play_url: string | null;
  provider_source_status: string | null;
  source_reason: string | null;
  last_synced_at: string | null;
}

/**
 * Source priority resolver.
 *
 * RULES (canonical):
 *   1. event_type='live_stream' AND platform_status='live'
 *      → ALWAYS prefer kinescope_live_event_id (live embed),
 *        even if kinescope_video_id уже заполнен (это будущая запись).
 *      → если live_event_id отсутствует, но мы в статусе 'live' — отдаём
 *        controlled 'live_pending' state (НИКОГДА blank).
 *   2. platform_status='replay_available' OR (event_status='ended' AND replay_enabled)
 *      → kinescope_video_id (replay).
 *   3. recorded_webinar / прочее
 *      → kinescope_video_id (если есть), иначе kinescope_live_event_id, иначе none.
 */
function resolveVideoSource(event: any): ResolvedSource {
  const meta = event.metadata as Record<string, any> | null;
  const providerStatus = meta?.provider_source_status || null;
  const lastSynced = meta?.last_synced_at || meta?.last_provider_sync_at || null;
  const platformStatus = event.platform_status || null;
  const isLiveStream = event.event_type === 'live_stream';
  const isLiveActive = platformStatus === 'live';
  const isReplay = platformStatus === 'replay_available'
    || (event.status === 'ended' && event.replay_enabled);

  // Helper: build live embed URL from provider metadata.
  // Priority: explicit embed_link → derived from play_link slug → null (live_pending).
  // NOTE: shape `https://kinescope.io/embed/live/<live_event_id>` НЕ работает у Kinescope для live —
  // правильная форма embed/<play_slug>.
  const providerCurrent = meta?.provider?.current as Record<string, any> | null | undefined;
  const embedLinkRaw: string | null = (providerCurrent?.embed_link ?? null) as string | null;
  const playLinkRaw: string | null = (providerCurrent?.play_link ?? null) as string | null;
  const embedLink = embedLinkRaw && typeof embedLinkRaw === 'string' && embedLinkRaw.trim().length > 0
    ? embedLinkRaw.trim()
    : null;
  const playSlug = (() => {
    if (!playLinkRaw || typeof playLinkRaw !== 'string') return null;
    const s = playLinkRaw.trim();
    if (!s) return null;
    const noProto = s.replace(/^https?:\/\/[^/]+\//, '');
    const slug = noProto.split(/[/?#]/)[0]?.trim() || null;
    return slug && slug.length > 0 ? slug : null;
  })();
  const liveEmbedUrl: string | null = embedLink
    ? embedLink
    : (playSlug ? `https://kinescope.io/embed/${playSlug}` : null);
  const liveEmbedReason: string = embedLink
    ? 'active_live_via_embed_link'
    : (playSlug ? 'active_live_via_play_link' : 'active_live_pending_play_link');

  // Priority 1 — ACTIVE LIVE: live embed must win over any pre-existing video_id.
  if (isLiveStream && isLiveActive) {
    if (liveEmbedUrl) {
      return {
        resolved_source_kind: 'kinescope_live_embed',
        resolved_embed_url: liveEmbedUrl,
        resolved_play_url: playLinkRaw || null,
        provider_source_status: providerStatus,
        source_reason: liveEmbedReason,
        last_synced_at: lastSynced,
      };
    }
    return {
      resolved_source_kind: 'live_pending',
      resolved_embed_url: null,
      resolved_play_url: null,
      provider_source_status: providerStatus,
      source_reason: 'live_pending_provider_sync',
      last_synced_at: lastSynced,
    };
  }

  // Priority 2 — REPLAY: завершённый эфир с записью.
  if (isReplay && event.kinescope_video_id) {
    return {
      resolved_source_kind: 'kinescope_video',
      resolved_embed_url: `https://kinescope.io/embed/${event.kinescope_video_id}`,
      resolved_play_url: `https://kinescope.io/${event.kinescope_video_id}`,
      provider_source_status: providerStatus,
      source_reason: 'replay',
      last_synced_at: lastSynced,
    };
  }

  // Priority 3 — recorded_webinar / другое: video_id, потом live_event_id (legacy).
  if (event.kinescope_video_id) {
    return {
      resolved_source_kind: 'kinescope_video',
      resolved_embed_url: `https://kinescope.io/embed/${event.kinescope_video_id}`,
      resolved_play_url: `https://kinescope.io/${event.kinescope_video_id}`,
      provider_source_status: providerStatus,
      source_reason: 'recorded_or_default',
      last_synced_at: lastSynced,
    };
  }

  if (event.kinescope_live_event_id) {
    if (liveEmbedUrl) {
      return {
        resolved_source_kind: 'kinescope_live_embed',
        resolved_embed_url: liveEmbedUrl,
        resolved_play_url: playLinkRaw || null,
        provider_source_status: providerStatus,
        source_reason: 'live_embed_fallback_via_provider',
        last_synced_at: lastSynced,
      };
    }
    return {
      resolved_source_kind: 'live_pending',
      resolved_embed_url: null,
      resolved_play_url: null,
      provider_source_status: providerStatus,
      source_reason: 'live_pending_no_embed_link',
      last_synced_at: lastSynced,
    };
  }

  return {
    resolved_source_kind: 'none',
    resolved_embed_url: null,
    resolved_play_url: null,
    provider_source_status: providerStatus,
    source_reason: 'no_kinescope_id',
    last_synced_at: lastSynced,
  };
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function logAudit(
  supabase: any,
  action: string,
  userId: string | null,
  slug: string,
  eventId: string | null,
  meta?: Record<string, any>,
) {
  try {
    await supabase.from('audit_logs').insert({
      action,
      actor_type: userId ? 'user' : 'system',
      actor_user_id: userId,
      meta: { slug, live_event_id: eventId, ...meta },
    });
  } catch (e) {
    console.error('[live-resolve] Audit log error:', e);
  }
}
