// autoweb-session-heartbeat
// Sprint / Phase A: единственная точка записи lifecycle-фактов автовебинара.
//
// НЕ путать с live-session-heartbeat (тот — presence-tracker для живых эфиров через
// live_active_sessions). Здесь — обновление live_event_sessions.status / metadata по
// сигналам от плеера конкретной автовеб-сессии.
//
// Контракт запроса:
//   POST /autoweb-session-heartbeat
//   body: {
//     session_id: uuid,
//     player_state: 'idle' | 'ready' | 'playing' | 'paused' | 'ended' | 'autoplay_blocked',
//     current_time_seconds?: number,     // SoT прогресса. Wall-clock fallback только для idle/ready.
//     playback_started?: boolean         // true, если Kinescope уже реально начал воспроизведение
//                                        // (после первого timeupdate>0 либо state='playing')
//   }
//
// Инварианты Фазы A:
//   1. auto_started_at / status='live' проставляется ТОЛЬКО когда:
//        player_state === 'playing' AND playback_started === true.
//      Ни autoplay_blocked, ни wall_clock самого по себе не переводят сессию в live.
//   2. autoplay_blocked НИКОГДА не пишет auto_started_at / auto_webinar_started /
//      scenario_started; фиксируется только факт блокировки (один раз на сессию).
//   3. Все переходы — через CAS (compare-and-set) по status + metadata JSON-path,
//      чтобы параллельные запросы не задублировали audit.
//   4. self_heal_noop не спамится: audit пишется только когда reason сменился.
//   5. Compare-and-set на записи: metadata обновляется ТОЛЬКО при реальной смене поля.
//
// Add-only metadata SoT (никогда не удаляем существующие ключи):
//   auto_room_opened_at, auto_started_at, auto_ended_at,
//   last_heartbeat_at, last_player_state, last_current_time_seconds, last_noop_reason
//
// INVARIANT (Phase A.verify, FP-2/FP-3 Variant A — add-only, 2026-07-09):
//   • SoT режима: live_events.autoweb_mode. Поля autoweb_config.mode не существует.
//   • event_type='recorded_webinar' допустим в whitelist ТОЛЬКО как legacy-контейнер
//     для autoweb_mode='one_time'. Исключать recorded_webinar из whitelist ЗАПРЕЩЕНО —
//     это сломает legacy one_time-поток (дефект D4, Variant A).
//   • Для recorded_webinar никакие autoweb-режимы кроме one_time не поддерживаются;
//     scheduled/JIT/on_demand для recorded_webinar считать невалидной конфигурацией.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PlayerState = 'idle' | 'ready' | 'playing' | 'paused' | 'ended' | 'autoplay_blocked';
const VALID_STATES: PlayerState[] = ['idle', 'ready', 'playing', 'paused', 'ended', 'autoplay_blocked'];

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string | null;
  actor_type: string;
  meta: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes({ status: 'error', message: 'POST only' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Auth (verify_jwt=true в config.toml, но проверим явно для actor_user_id).
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const actor_user_id = userData?.user?.id ?? null;
    if (!actor_user_id) return jsonRes({ status: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const session_id: string | undefined = body?.session_id;
    const player_state: PlayerState = body?.player_state;
    const current_time_seconds: number = Number(body?.current_time_seconds ?? 0);
    const playback_started: boolean = !!body?.playback_started;

    if (!session_id || !VALID_STATES.includes(player_state)) {
      return jsonRes({ status: 'error', message: 'session_id + valid player_state required' }, 400);
    }

    // Load session + event.
    const { data: session, error: sErr } = await admin
      .from('live_event_sessions')
      .select('id, live_event_id, starts_at, ends_at, status, metadata')
      .eq('id', session_id)
      .maybeSingle();
    if (sErr || !session) return jsonRes({ status: 'not_found' }, 404);

    const { data: event } = await admin
      .from('live_events')
      .select('id, event_type')
      .eq('id', session.live_event_id)
      .maybeSingle();
    if (!event || (event.event_type !== 'autowebinar' && event.event_type !== 'recorded_webinar')) {
      return jsonRes({ status: 'unsupported_event_type' }, 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const startsAt = new Date(session.starts_at).getTime();
    const endsAt = new Date(session.ends_at).getTime();
    const meta = (session.metadata ?? {}) as Record<string, any>;

    const audits: AuditRow[] = [];
    const auditBase = {
      entity_type: 'live_event_session',
      entity_id: session.id,
      actor_user_id,
      actor_type: 'user',
    };

    // Собираем delta: пишем ТОЛЬКО реальные изменения (compare-and-set).
    const delta: Record<string, unknown> = {};
    let noopReason: string | null = null;

    // --- 1. auto_room_opened_at: CAS через условный UPDATE, ставим один раз ---
    if (!meta.auto_room_opened_at && now.getTime() >= startsAt - 10 * 60_000) {
      // CAS: обновляем только если поле всё ещё null.
      const { data: casRoom } = await admin
        .from('live_event_sessions')
        .update({
          metadata: { ...meta, auto_room_opened_at: nowIso },
          updated_at: nowIso,
        })
        .eq('id', session.id)
        .filter('metadata->>auto_room_opened_at', 'is', null)
        .select('metadata')
        .maybeSingle();
      if (casRoom) {
        meta.auto_room_opened_at = nowIso;
        audits.push({
          ...auditBase,
          action: 'auto_room_opened',
          meta: { at: nowIso, wall_clock_vs_starts_at_seconds: (now.getTime() - startsAt) / 1000 },
        });
      }
    }

    // --- 2. autoplay_blocked: один раз на сессию ---
    if (player_state === 'autoplay_blocked' && !meta.autoplay_blocked_at) {
      const { data: casAutoBlock } = await admin
        .from('live_event_sessions')
        .update({
          metadata: { ...meta, autoplay_blocked_at: nowIso },
          updated_at: nowIso,
        })
        .eq('id', session.id)
        .filter('metadata->>autoplay_blocked_at', 'is', null)
        .select('metadata')
        .maybeSingle();
      if (casAutoBlock) {
        meta.autoplay_blocked_at = nowIso;
        audits.push({ ...auditBase, action: 'autoplay_blocked', meta: { at: nowIso } });
      }
      noopReason = 'autoplay_blocked_no_start';
    }

    // --- 3. auto_started_at + status='live' — ТОЛЬКО при подтверждённом playback ---
    const canStart =
      player_state === 'playing' &&
      playback_started === true &&
      !meta.auto_started_at &&
      now.getTime() >= startsAt;

    if (canStart) {
      const newMeta = { ...meta, auto_started_at: nowIso };
      // Атомарный CAS: status='pending' AND metadata.auto_started_at IS NULL.
      const { data: casStart } = await admin
        .from('live_event_sessions')
        .update({ status: 'live', metadata: newMeta, updated_at: nowIso })
        .eq('id', session.id)
        .eq('status', 'pending')
        .filter('metadata->>auto_started_at', 'is', null)
        .select('id, status, metadata')
        .maybeSingle();
      if (casStart) {
        meta.auto_started_at = nowIso;
        session.status = 'live';
        audits.push({
          ...auditBase,
          action: 'auto_webinar_started',
          meta: {
            at: nowIso,
            current_time_seconds,
            wall_clock_vs_starts_at_seconds: (now.getTime() - startsAt) / 1000,
          },
        });
      }
    } else if (!meta.auto_started_at && player_state !== 'autoplay_blocked') {
      // Guard-noop: player ещё не готов → сценарий/старт заблокированы.
      if (player_state === 'paused' || player_state === 'idle' || player_state === 'ready') {
        noopReason = `guard_scenario_needs_playback:${player_state}`;
      }
    }

    // --- 4. auto_ended_at + status='ended' — по факту ended плеера ИЛИ wall_clock >= ends_at ---
    const shouldEnd =
      !meta.auto_ended_at &&
      (player_state === 'ended' || now.getTime() >= endsAt);
    if (shouldEnd) {
      const { data: casEnd } = await admin
        .from('live_event_sessions')
        .update({
          status: 'ended',
          metadata: { ...meta, auto_ended_at: nowIso },
          updated_at: nowIso,
        })
        .eq('id', session.id)
        .in('status', ['pending', 'live'])
        .filter('metadata->>auto_ended_at', 'is', null)
        .select('id, status')
        .maybeSingle();
      if (casEnd) {
        meta.auto_ended_at = nowIso;
        session.status = 'ended';
        audits.push({
          ...auditBase,
          action: 'webinar_ended',
          meta: { at: nowIso, reason: player_state === 'ended' ? 'player_ended' : 'wall_clock' },
        });
      }
    }

    // --- 5. Compare-and-set по «пульсу» — пишем только при смене состояния ---
    const heartbeatDelta: Record<string, unknown> = {};
    if (meta.last_player_state !== player_state) {
      heartbeatDelta.last_player_state = player_state;
    }
    // last_current_time_seconds: пишем только если сдвинулся значимо (>=2s) или сменился state
    const prevTime = Number(meta.last_current_time_seconds ?? 0);
    if (Math.abs(current_time_seconds - prevTime) >= 2 || heartbeatDelta.last_player_state) {
      heartbeatDelta.last_current_time_seconds = current_time_seconds;
    }
    // last_heartbeat_at: не каждый тик. Пишем только если сменился state ИЛИ прошло >=60s
    const prevHb = meta.last_heartbeat_at ? new Date(meta.last_heartbeat_at).getTime() : 0;
    if (heartbeatDelta.last_player_state || now.getTime() - prevHb >= 60_000) {
      heartbeatDelta.last_heartbeat_at = nowIso;
    }
    // noop_reason: пишем только при смене
    if (noopReason && meta.last_noop_reason !== noopReason) {
      heartbeatDelta.last_noop_reason = noopReason;
      audits.push({
        ...auditBase,
        action: 'autoweb_self_heal_noop',
        meta: { reason: noopReason, player_state, phase_ends_at: session.ends_at },
      });
    } else if (!noopReason && meta.last_noop_reason) {
      heartbeatDelta.last_noop_reason = null;
    }

    if (Object.keys(heartbeatDelta).length > 0) {
      await admin
        .from('live_event_sessions')
        .update({
          metadata: { ...meta, ...heartbeatDelta },
          updated_at: nowIso,
        })
        .eq('id', session.id);
    }

    // --- 6. Audit insert (одним батчем, только реальные события) ---
    if (audits.length > 0) {
      await admin.from('audit_logs').insert(audits);
    }

    return jsonRes({
      status: 'ok',
      session_status: session.status,
      auto_room_opened: !!meta.auto_room_opened_at,
      auto_started: !!meta.auto_started_at,
      auto_ended: !!meta.auto_ended_at,
      autoplay_blocked: !!meta.autoplay_blocked_at,
      wrote_audits: audits.map((a) => a.action),
    });
  } catch (e) {
    console.error('[autoweb-session-heartbeat] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
