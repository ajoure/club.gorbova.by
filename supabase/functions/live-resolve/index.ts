import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';

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
      .select('id, slug, title, description, kinescope_video_id, product_id, access_rule, status, is_published, scheduled_at, replay_enabled, invite_mode, direct_access_allowed, event_type, source_kind, event_timezone, platform_status, kinescope_live_event_id, metadata')
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
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      await logAudit(supabase, 'live_access_attempt', null, slug, event.id, { reason: 'invalid_token' });
      return jsonRes({ status: 'auth_required' }, 401);
    }

    const userId = user.id;

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
        .select('product_id, tariff_id')
        .eq('live_event_id', event.id);

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

    // 6. Access granted
    await logAudit(supabase, 'live_access_granted', userId, slug, event.id, {
      product_id: event.product_id,
    });

    return jsonRes({
      status: 'ok',
      title: event.title,
      description: event.description,
      kinescope_video_id: event.kinescope_video_id,
      event_status: event.status,
      scheduled_at: event.scheduled_at,
      replay_enabled: event.replay_enabled,
      event_id: event.id,
      event_type: event.event_type,
      source_kind: event.source_kind,
      event_timezone: event.event_timezone,
      platform_status: event.platform_status,
      kinescope_live_event_id: event.kinescope_live_event_id,
    });
  } catch (err) {
    console.error('[live-resolve] Unexpected error:', err);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});

// autoCreateSession removed — sessions are created ONLY in live-token-validate

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
