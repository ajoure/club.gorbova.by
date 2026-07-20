// autoweb-room-state
// Sprint B: PURE COMPUTE resolver. ZERO DB writes.
//
// Контракт ответа зафиксирован в supabase/functions/_shared/autoweb-types.ts
// и импортируется обеими сторонами (edge + client).
//
// Phase computation:
//   pre_show  : now < starts_at
//   live      : starts_at <= now < ends_at  (ends_at = starts_at + duration)
//   replay    : ends_at <= now < replay_ends_at (с учётом open_strategy/delay)
//   ended     : иначе
//
// resume.last_video_position_seconds читается из live_event_session_progress
// строго по (session_id, viewer_user_id). НИКОГДА не пишется здесь.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type {
  AutowebPhase,
  AutowebRoomStateResponse,
  AutowebViewerControls,
  AutowebResumeContract,
} from '../_shared/autoweb-types.ts';

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

const DEFAULT_VIEWER_CONTROLS: AutowebViewerControls = {
  allow_pause: false,
  allow_seek: false,
  allow_speed_control: false,
  resume_from_last_position: true,
  allow_rewatch_before_end: false,
};

interface ComputeInput {
  now: Date;
  starts_at: Date;
  duration_seconds: number;
  replay: {
    enabled: boolean;
    open_strategy: 'immediate' | 'after_delay';
    delay_minutes: number;
    window_hours: number;
  };
  viewer_controls: AutowebViewerControls;
  saved_position_seconds: number;
}

export interface ComputeResult {
  phase: AutowebPhase;
  ends_at: Date;
  replay_opens_at: Date | null;
  replay_ends_at: Date | null;
  session_playback_position_seconds: number;
  resume: AutowebResumeContract;
}

/**
 * Pure compute. Экспортирована для unit-тестов.
 */
export function computeRoomState(input: ComputeInput): ComputeResult {
  const ends_at = new Date(input.starts_at.getTime() + input.duration_seconds * 1000);

  let replay_opens_at: Date | null = null;
  let replay_ends_at: Date | null = null;

  if (input.replay.enabled && input.replay.window_hours > 0) {
    const delayMs =
      input.replay.open_strategy === 'after_delay'
        ? Math.max(0, input.replay.delay_minutes) * 60_000
        : 0;
    replay_opens_at = new Date(ends_at.getTime() + delayMs);
    replay_ends_at = new Date(replay_opens_at.getTime() + input.replay.window_hours * 3_600_000);
  }

  let phase: AutowebPhase;
  const t = input.now.getTime();
  if (t < input.starts_at.getTime()) {
    phase = 'pre_show';
  } else if (t < ends_at.getTime()) {
    phase = 'live';
  } else if (replay_opens_at && replay_ends_at && t >= replay_opens_at.getTime() && t < replay_ends_at.getTime()) {
    phase = 'replay';
  } else {
    phase = 'ended';
  }

  const resume: AutowebResumeContract = {
    enabled: !!input.viewer_controls.resume_from_last_position,
    last_video_position_seconds: input.viewer_controls.resume_from_last_position
      ? Math.max(0, Math.floor(input.saved_position_seconds || 0))
      : 0,
  };

  // Поздний вход синхронизируется только с активным показом. Replay — это
  // отдельный просмотр записи, поэтому начинает с 0 либо с личного resume.
  const session_playback_position_seconds = phase === 'live'
    ? Math.min(
        Math.max(0, Math.floor((t - input.starts_at.getTime()) / 1000)),
        Math.max(0, Math.floor(input.duration_seconds)),
      )
    : 0;

  return {
    phase,
    ends_at,
    replay_opens_at,
    replay_ends_at,
    session_playback_position_seconds,
    resume,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const viewerTzParam = url.searchParams.get('viewer_timezone') || 'UTC';

    if (!sessionId) {
      return jsonRes({ status: 'error', message: 'session_id required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const viewerUserId = userData?.user?.id ?? null;
    if (!viewerUserId) return jsonRes({ status: 'unauthorized' }, 401);

    // READ-ONLY load. Никаких UPDATE.
    const { data: session, error: sErr } = await admin
      .from('live_event_sessions')
      .select('id, live_event_id, starts_at, ends_at, mode, viewer_user_id, status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sErr || !session) return jsonRes({ status: 'not_found' }, 404);

    const { data: event, error: eErr } = await admin
      .from('live_events')
      .select('id, event_type, autoweb_mode, autoweb_config, event_timezone, is_published, source_live_event_id, platform_status, status, replay_enabled')
      .eq('id', session.live_event_id)
      .maybeSingle();
    if (eErr || !event) return jsonRes({ status: 'not_found' }, 404);
    if (event.event_type !== 'autowebinar' && event.event_type !== 'recorded_webinar') {
      return jsonRes({ status: 'unsupported_event_type', event_type: event.event_type }, 400);
    }

    const [{ data: isAdmin }, { data: isSuperAdmin }, { data: isEmployee }] = await Promise.all([
      admin.rpc('has_role_v2', { _user_id: viewerUserId, _role_code: 'admin' }),
      admin.rpc('has_role_v2', { _user_id: viewerUserId, _role_code: 'super_admin' }),
      admin.rpc('has_role_v2', { _user_id: viewerUserId, _role_code: 'employee' }),
    ]);
    const isStaff = isAdmin === true || isSuperAdmin === true || isEmployee === true;
    const isPersonalSession = !!(session as any).viewer_user_id;
    const ownsPersonalSession = (session as any).viewer_user_id === viewerUserId;
    const { data: hasEventAccess } = isStaff
      ? { data: true }
      : await admin.rpc('user_has_live_event_access', {
          _user_id: viewerUserId,
          _live_event_id: session.live_event_id,
        });
    if (!isStaff && (!hasEventAccess || (isPersonalSession && !ownsPersonalSession))) {
      return jsonRes({ status: 'access_denied' }, 403);
    }
    const terminal = (event as any).platform_status === 'ended'
      || (event as any).platform_status === 'archived'
      || (event as any).status === 'ended';
    if (terminal && !(event as any).replay_enabled) {
      return jsonRes({ status: 'replay_disabled' }, 410);
    }

    // Опционально подтягиваем время фактического старта исходного эфира для timed-replay.
    // Приоритет: live_started_at (реальный старт трансляции) → room_opened_at (комната открыта)
    // → starts_at (запланированная дата). Именно эта точка используется как t0 для
    // проигрывания истории чата/вопросов синхронно с видео.
    let source_started_at: string | null = null;
    if (event.source_live_event_id) {
      const { data: src } = await admin
        .from('live_events')
        .select('starts_at, live_started_at, room_opened_at')
        .eq('id', event.source_live_event_id)
        .maybeSingle();
      source_started_at =
        (src as any)?.live_started_at ??
        (src as any)?.room_opened_at ??
        (src as any)?.starts_at ??
        null;
    }

    const cfg = (event.autoweb_config ?? {}) as Record<string, any>;
    const duration_seconds = Number(cfg?.video?.duration_seconds ?? 3600);

    const replayCfg = {
      enabled: cfg?.replay?.enabled !== false,
      open_strategy: (cfg?.replay?.open_strategy ?? 'immediate') as 'immediate' | 'after_delay',
      delay_minutes: Number(cfg?.replay?.delay_minutes ?? 0),
      window_hours: Number(cfg?.replay?.window_hours ?? 0),
    };

    const viewer_controls: AutowebViewerControls = {
      ...DEFAULT_VIEWER_CONTROLS,
      ...(cfg?.viewer_controls ?? {}),
    };

    const { data: progress } = await admin
      .from('live_event_session_progress')
      .select('last_video_position_seconds')
      .eq('session_id', session.id)
      .eq('viewer_user_id', viewerUserId)
      .maybeSingle();
    const saved_position_seconds = Number((progress as any)?.last_video_position_seconds ?? 0);

    const computed = computeRoomState({
      now: new Date(),
      starts_at: new Date(session.starts_at),
      duration_seconds,
      replay: replayCfg,
      viewer_controls,
      saved_position_seconds,
    });

    const response: AutowebRoomStateResponse = {
      status: 'ok',
      phase: computed.phase,
      session_id: session.id,
      live_event_id: session.live_event_id,
      starts_at: session.starts_at,
      ends_at: computed.ends_at.toISOString(),
      replay_opens_at: computed.replay_opens_at?.toISOString() ?? null,
      replay_ends_at: computed.replay_ends_at?.toISOString() ?? null,
      viewer_controls,
      timeline_enabled: cfg?.timeline?.enabled !== false,
      chat_enabled: cfg?.chat?.enabled !== false,
      questions_enabled: cfg?.questions?.enabled !== false,
      session_playback_position_seconds: computed.session_playback_position_seconds,
      resume: computed.resume,
      viewer_timezone: viewerTzParam,
      event_timezone: event.event_timezone ?? cfg?.schedule?.timezone ?? 'Europe/Minsk',
      kinescope_video_id: cfg?.video?.kinescope_video_id ?? null,
      source_live_event_id: event.source_live_event_id ?? null,
      source_started_at,
    };

    return jsonRes(response);
  } catch (e) {
    console.error('[autoweb-room-state] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
