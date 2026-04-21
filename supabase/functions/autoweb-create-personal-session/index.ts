// autoweb-create-personal-session
// Sprint A (PATCH-1): создаёт персональную сессию для JIT/on_demand.
//
// DEDUPE-ПОЛИТИКА (согласовано в Sprint A review):
//   • JIT       → bucket: (live_event_id, viewer_user_id, offset_minutes, 5-min time bucket)
//                  → если viewer выбрал 5 мин подряд несколько раз — вернётся ОДНА сессия
//   • on_demand → любая существующая активная сессия (pending|live, ends_at > now()) этого viewer'а
//                  → пользователь не может «накликать» пачку параллельных on-demand сессий
//
// Это сильнее, чем старый «60 секунд», и соответствует согласованному time-bucket подходу.

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

/** Округляет timestamp вниз до bucket-минут. */
function bucketStartIso(date: Date, bucketMinutes: number): string {
  const ms = bucketMinutes * 60_000;
  const t = Math.floor(date.getTime() / ms) * ms;
  return new Date(t).toISOString();
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
    let chosenOffset = 0;
    if (mode === 'just_in_time') {
      const allowedOffsets: number[] = Array.isArray(cfg?.just_in_time?.offsets_minutes)
        ? cfg.just_in_time.offsets_minutes
        : [5, 10, 15, 30];
      const off = Number(offsetMinutes ?? 5);
      if (!allowedOffsets.includes(off)) {
        return jsonRes({ status: 'invalid_offset', allowed: allowedOffsets }, 400);
      }
      chosenOffset = off;
      startsAt = new Date(Date.now() + off * 60_000);
    } else {
      const minDelay = Math.max(0, Number(cfg?.on_demand?.min_delay_seconds ?? 0));
      startsAt = new Date(Date.now() + minDelay * 1000);
    }

    const endsAt = new Date(
      startsAt.getTime() + duration * 1000 + replayDelayMin * 60_000 + replayWindowH * 3600_000,
    );

    // --- DEDUPE ---
    const nowIso = new Date().toISOString();

    if (mode === 'just_in_time') {
      // 5-минутный bucket по starts_at
      const bucketIso = bucketStartIso(startsAt, 5);
      const bucketEndIso = new Date(new Date(bucketIso).getTime() + 5 * 60_000).toISOString();

      const { data: existing } = await admin
        .from('live_event_sessions')
        .select('id, starts_at, ends_at, status, mode')
        .eq('live_event_id', liveEventId)
        .eq('viewer_user_id', viewerUserId)
        .eq('mode', 'just_in_time')
        .gte('starts_at', bucketIso)
        .lt('starts_at', bucketEndIso)
        .in('status', ['pending', 'live'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        return jsonRes({
          status: 'ok',
          session: existing[0],
          dedup: true,
          dedup_reason: 'jit_bucket_5min',
          chosen_offset: chosenOffset,
        });
      }
    } else {
      // on_demand → любая активная сессия (ends_at > now), pending|live
      const { data: existing } = await admin
        .from('live_event_sessions')
        .select('id, starts_at, ends_at, status, mode')
        .eq('live_event_id', liveEventId)
        .eq('viewer_user_id', viewerUserId)
        .eq('mode', 'on_demand')
        .gt('ends_at', nowIso)
        .in('status', ['pending', 'live'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        return jsonRes({
          status: 'ok',
          session: existing[0],
          dedup: true,
          dedup_reason: 'on_demand_active_session',
        });
      }
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
      .select('id, starts_at, ends_at, status, mode')
      .single();

    if (cErr) {
      // Race: уникальный partial index live_event_sessions_personal_uq защищает на уровне БД
      if ((cErr as any).code === '23505') {
        const { data: existing2 } = await admin
          .from('live_event_sessions')
          .select('id, starts_at, ends_at, status, mode')
          .eq('live_event_id', liveEventId)
          .eq('viewer_user_id', viewerUserId)
          .eq('starts_at', startsAt.toISOString())
          .limit(1);
        if (existing2 && existing2.length > 0) {
          return jsonRes({ status: 'ok', session: existing2[0], dedup: true, dedup_reason: 'race_unique_index' });
        }
      }
      console.error('[autoweb-create-personal-session] insert err', cErr);
      return jsonRes({ status: 'error', message: 'Could not create session' }, 500);
    }

    return jsonRes({ status: 'ok', session: created, dedup: false, chosen_offset: chosenOffset });
  } catch (e) {
    console.error('[autoweb-create-personal-session] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
