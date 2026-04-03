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

    // 1. Find event by slug (using service role - bypasses RLS)
    const { data: event, error: eventError } = await supabase
      .from('live_events')
      .select('id, slug, title, description, kinescope_video_id, product_id, access_rule, status, is_published, scheduled_at, replay_enabled, invite_mode, direct_access_allowed')
      .eq('slug', slug)
      .maybeSingle();

    if (eventError) {
      console.error('[live-resolve] DB error:', eventError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Internal error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Branch 1: slug not found
    if (!event) {
      await logAudit(supabase, 'live_access_not_found', null, slug, null);
      return new Response(
        JSON.stringify({ status: 'not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Branch 2: not published
    if (!event.is_published) {
      await logAudit(supabase, 'live_access_unpublished', null, slug, event.id);
      return new Response(
        JSON.stringify({ status: 'unpublished' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Branch 3: check authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await logAudit(supabase, 'live_access_attempt', null, slug, event.id, { reason: 'no_auth_header' });
      return new Response(
        JSON.stringify({ status: 'auth_required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      await logAudit(supabase, 'live_access_attempt', null, slug, event.id, { reason: 'invalid_token' });
      return new Response(
        JSON.stringify({ status: 'auth_required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Branch 4: access check using canonical resolver
    const accessRule = event.access_rule as AccessRule;
    let accessValid = false;

    if (accessRule.mode === 'all') {
      // Any authenticated user can access
      accessValid = true;
    } else {
      // mode='product' or mode='tariff' — check canonical product access
      const productId = accessRule.product_id || event.product_id;
      const snapshot = await resolveEffectiveProductAccess(supabase, userId, productId);

      if (snapshot.effectiveEndAt !== undefined || snapshot.isUnlimited) {
        // Has some access source
        if (snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > new Date())) {
          accessValid = true;
        }
      }

      // Additional tariff check for mode='tariff'
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
          // Check entitlements with tariff in meta
          const { data: tariffEnt } = await supabase
            .from('entitlements')
            .select('id')
            .eq('user_id', userId)
            .eq('product_id', productId)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();

          // If no tariff-specific subscription, deny
          if (!tariffEnt) {
            accessValid = false;
          }
        }
      }
    }

    if (!accessValid) {
      await logAudit(supabase, 'live_access_denied', userId, slug, event.id, {
        access_rule_mode: accessRule.mode,
        product_id: event.product_id,
      });
      return new Response(
        JSON.stringify({
          status: 'access_denied',
          title: event.title,
          description: event.description,
          event_status: event.status,
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Branch 5: access granted — return full data including kinescope_video_id
    await logAudit(supabase, 'live_access_granted', userId, slug, event.id, {
      access_rule_mode: accessRule.mode,
      product_id: event.product_id,
    });

    return new Response(
      JSON.stringify({
        status: 'ok',
        title: event.title,
        description: event.description,
        kinescope_video_id: event.kinescope_video_id,
        event_status: event.status,
        scheduled_at: event.scheduled_at,
        replay_enabled: event.replay_enabled,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[live-resolve] Unexpected error:', err);
    return new Response(
      JSON.stringify({ status: 'error', message: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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
