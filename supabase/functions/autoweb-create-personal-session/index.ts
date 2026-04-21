// autoweb-create-personal-session
// Sprint A — создаёт персональную сессию для JIT/on_demand при выборе зрителем слота.
// Защита: dedupe по (live_event_id, viewer_user_id, time bucket = 1 минута).

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ status: 'error', message: 'POST only' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // JWT auth: viewer_user_id берём из токена
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResp } = await userClient.auth.getUser();
    const viewerUserId = userResp?.user?.id ?? null;
    if (!viewerUserId) {
      return jsonRes({ status: 'unauthorized', message: 'Auth required' }, 401);
    }

    const body = await req.json().catch(() => null);
    const liveEventId = body?.live_event_id as string | undefined;
    const offsetMinutes = body?.offset_minutes as number | undefined;
    if (!liveEventId) return jsonRes({ status: 'error', message: 'live_event_id required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: event, error: eErr } = await admin
      .from('live_events')
      .select('id, event_type, autoweb_mode, autoweb_config, is_published')
      .eq('id', liveEventId)
      .maybeSingle();
    if (eErr || !event) return jsonRes({ status: 'not_found' }, 404);
    if (!event.is_published) return jsonRes({ status: 'unpublished' }, 403);
    if (event.event_type !== 'autowebinar') {
      return jsonRes({ status: 'unsupported_event_type' }, 400);
    }

    const mode = event.autoweb_mode as string;
    if (mode !== 'just_in_time' && mode !== 'on_demand') {
      return jsonRes({ status: 'unsupported_mode', mode }, 400);
    }

    const cfg = (event.autoweb_config ?? {}) as Record<string, any>;
    const duration = Number(cfg?.video?.duration_seconds ?? 3600);
    const replayWindowH = Number(cfg?.replay?.window_hours ?? 0);
    const replayDelayMin = Number(cfg?.replay?.delay_minutes ?? 0);

    let startsAt: Date;
    if (mode === 'just_in_time') {
      const allowedOffsets: number[] = Array.isArray(cfg?.just_in_time?.offsets_minutes)
        ? cfg.just_in_time.offsets_minutes
        : [5, 10, 15, 30];
      const off = Number(offsetMinutes ?? 5);
      if (!allowedOffsets.includes(off)) {
        return jsonRes({ status: 'invalid_offset', allowed: allowedOffsets }, 400);
      }
      startsAt = new Date(Date.now() + off * 60_000);
    } else {
      const minDelay = Math.max(0, Number(cfg?.on_demand?.min_delay_seconds ?? 0));
      startsAt = new Date(Date.now() + minDelay * 1000);
    }

    const endsAt = new Date(
      startsAt.getTime() + duration * 1000 + replayDelayMin * 60_000 + replayWindowH * 3600_000,
    );

    // Dedupe: если у viewer уже есть pending/live сессия за последние 60 секунд — вернуть её
    const dedupeSinceIso = new Date(Date.now() - 60_000).toISOString();
    const { data: existing } = await admin
      .from('live_event_sessions')
      .select('id, starts_at, ends_at, status')
      .eq('live_event_id', liveEventId)
      .eq('viewer_user_id', viewerUserId)
      .gte('created_at', dedupeSinceIso)
      .in('status', ['pending', 'live'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      return jsonRes({ status: 'ok', session: existing[0], dedup: true });
    }

    const { data: created, error: cErr } = await admin
      .from('live_event_sessions')
      .insert({
        live_event_id: liveEventId,
        mode,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        viewer_user_id: viewerUserId,
        status: 'pending',
      })
      .select('id, starts_at, ends_at, status')
      .single();

    if (cErr) {
      console.error('[autoweb-create-personal-session] insert err', cErr);
      return jsonRes({ status: 'error', message: 'Could not create session' }, 500);
    }

    return jsonRes({ status: 'ok', session: created, dedup: false });
  } catch (e) {
    console.error('[autoweb-create-personal-session] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
