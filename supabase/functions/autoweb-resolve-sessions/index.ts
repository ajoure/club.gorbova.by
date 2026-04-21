// autoweb-resolve-sessions
// Sprint A (PATCH-1): единая входная точка для лендинга/session selector автовебинара.
// Возвращает ближайшие сессии для всех 4 режимов (one_time/scheduled/just_in_time/on_demand).
// Для one_time → читает legacy live_events.scheduled_at (recorded_webinar) — без миграции данных.
//
// ACCESS MODEL (зафиксировано в Sprint A review):
//   • Это PUBLIC pre-входная точка (как существующий /live/:slug landing).
//   • Возвращает только метаданные расписания и слоты — НЕ выдаёт URL комнаты, токенов, видео-источника.
//   • Проверяет ТОЛЬКО is_published=true. Доступ по access_rules проверяется уже в комнате
//     (live-resolve / autoweb-room-state в Sprint B), а не здесь.
//   • Соответствует UX: незарегистрированный пользователь должен видеть «ближайшие старты»
//     и выбрать слот ПЕРЕД регистрацией.

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

interface JitOption {
  offset_minutes: number;
  starts_at: string; // ISO
}

interface ScheduledSlot {
  session_id: string;
  starts_at: string;
  ends_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const liveEventId = url.searchParams.get('live_event_id');
    const slug = url.searchParams.get('slug');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 20);

    if (!liveEventId && !slug) {
      return jsonRes({ status: 'error', message: 'live_event_id or slug is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) Resolve event
    const eventQuery = supabase
      .from('live_events')
      .select('id, slug, title, event_type, autoweb_mode, autoweb_config, scheduled_at, is_published, event_timezone')
      .limit(1);

    const { data: events, error: eventErr } = liveEventId
      ? await eventQuery.eq('id', liveEventId)
      : await eventQuery.eq('slug', slug!);

    if (eventErr) {
      console.error('[autoweb-resolve-sessions] event err', eventErr);
      return jsonRes({ status: 'error', message: 'Internal error' }, 500);
    }
    const event = events?.[0];
    if (!event) return jsonRes({ status: 'not_found' }, 404);
    if (!event.is_published) return jsonRes({ status: 'unpublished' }, 403);

    const cfg = (event.autoweb_config ?? {}) as Record<string, any>;
    const tz = cfg?.schedule?.timezone ?? event.event_timezone ?? 'Europe/Minsk';

    // 2) Determine effective mode
    // recorded_webinar (legacy) === one_time
    let mode: 'one_time' | 'scheduled' | 'just_in_time' | 'on_demand';
    if (event.event_type === 'autowebinar') {
      mode = (event.autoweb_mode ?? 'on_demand') as any;
    } else if (event.event_type === 'recorded_webinar') {
      mode = 'one_time';
    } else {
      // live_stream и прочие — этот edge не для них
      return jsonRes({ status: 'unsupported_event_type', event_type: event.event_type }, 400);
    }

    const nowIso = new Date().toISOString();

    if (mode === 'one_time') {
      return jsonRes({
        status: 'ok',
        mode,
        timezone: tz,
        one_time: { starts_at: event.scheduled_at },
      });
    }

    if (mode === 'scheduled') {
      const { data: sessions, error: sErr } = await supabase
        .from('live_event_sessions')
        .select('id, starts_at, ends_at, status')
        .eq('live_event_id', event.id)
        .is('viewer_user_id', null)
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(limit);

      if (sErr) {
        console.error('[autoweb-resolve-sessions] sched err', sErr);
        return jsonRes({ status: 'error', message: 'Internal error' }, 500);
      }

      const slots: ScheduledSlot[] = (sessions ?? []).map((s: any) => ({
        session_id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      }));

      return jsonRes({
        status: 'ok',
        mode,
        timezone: tz,
        scheduled: { upcoming: slots },
      });
    }

    if (mode === 'just_in_time') {
      const offsets: number[] = Array.isArray(cfg?.just_in_time?.offsets_minutes)
        ? cfg.just_in_time.offsets_minutes
        : [5, 10, 15, 30];
      const showCountdown = cfg?.just_in_time?.show_countdown !== false;
      const nowMs = Date.now();
      const options: JitOption[] = offsets
        .filter((m) => Number.isFinite(m) && m >= 0 && m <= 240)
        .map((m) => ({
          offset_minutes: m,
          starts_at: new Date(nowMs + m * 60_000).toISOString(),
        }));

      return jsonRes({
        status: 'ok',
        mode,
        timezone: tz,
        just_in_time: { options, show_countdown: showCountdown },
      });
    }

    // on_demand
    const minDelay = Math.max(0, Number(cfg?.on_demand?.min_delay_seconds ?? 0));
    return jsonRes({
      status: 'ok',
      mode,
      timezone: tz,
      on_demand: {
        starts_at: new Date(Date.now() + minDelay * 1000).toISOString(),
        min_delay_seconds: minDelay,
      },
    });
  } catch (e) {
    console.error('[autoweb-resolve-sessions] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
