-- =====================================================================
-- AUTOWEBINAR ENGINE v1 — Sprint A: Core schema
-- =====================================================================
-- - 4 modes: one_time (legacy recorded_webinar) | scheduled | just_in_time | on_demand
-- - event_type='autowebinar' for last 3 modes; one_time остаётся в recorded_webinar
-- - session-level model with partial unique indexes (public vs personal)
-- - status в session — кэш, не SoT (room state считается из starts_at + duration + replay)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. live_events: новые поля
-- ---------------------------------------------------------------------
ALTER TABLE public.live_events
  ADD COLUMN IF NOT EXISTS autoweb_mode text NULL,
  ADD COLUMN IF NOT EXISTS autoweb_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Допустимые значения autoweb_mode (NULL = не autowebinar)
ALTER TABLE public.live_events
  DROP CONSTRAINT IF EXISTS live_events_autoweb_mode_check;
ALTER TABLE public.live_events
  ADD CONSTRAINT live_events_autoweb_mode_check
  CHECK (autoweb_mode IS NULL OR autoweb_mode IN ('scheduled','just_in_time','on_demand'));

-- Инвариант: autoweb_mode задан ⇒ event_type='autowebinar'
-- (one_time остаётся как recorded_webinar и autoweb_mode=NULL)
ALTER TABLE public.live_events
  DROP CONSTRAINT IF EXISTS live_events_autoweb_mode_event_type_check;
ALTER TABLE public.live_events
  ADD CONSTRAINT live_events_autoweb_mode_event_type_check
  CHECK (
    (autoweb_mode IS NULL)
    OR (event_type = 'autowebinar')
  );

COMMENT ON COLUMN public.live_events.autoweb_mode IS
  'Autowebinar mode: scheduled | just_in_time | on_demand. NULL для live_stream/recorded_webinar (one_time показ).';
COMMENT ON COLUMN public.live_events.autoweb_config IS
  'JSON: schedule{rrule,timezone,occurrences_window_days,blackout_dates}, just_in_time{offsets_minutes,show_countdown}, on_demand{min_delay_seconds}, replay{enabled,open_strategy,delay_minutes,window_hours,show_chat_history,cta_strategy}, video{kinescope_video_id,duration_seconds}, viewer_controls{allow_pause,allow_seek,allow_speed_control,resume_from_last_position,allow_rewatch_before_end}';


-- ---------------------------------------------------------------------
-- 2. live_event_sessions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('scheduled','just_in_time','on_demand')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  viewer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_proof_id uuid NULL,
  -- status — КЭШ для UI/диагностики; реальное состояние считается на лету
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','live','replay','ended','expired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.live_event_sessions IS
  'Сеанс показа автовебинара. Для scheduled — публичные сессии (viewer_user_id NULL). Для JIT/on_demand — персональные (viewer_user_id NOT NULL).';
COMMENT ON COLUMN public.live_event_sessions.status IS
  'КЭШ состояния (для UI/диагностики). Реальное состояние комнаты считается из starts_at + duration_seconds + replay.* в autoweb-room-state.';

-- Partial unique: public scheduled — один публичный слот на (event, starts_at)
CREATE UNIQUE INDEX IF NOT EXISTS live_event_sessions_public_uq
  ON public.live_event_sessions (live_event_id, starts_at)
  WHERE viewer_user_id IS NULL;

-- Partial unique: personal — один персональный слот на (event, starts_at, user)
CREATE UNIQUE INDEX IF NOT EXISTS live_event_sessions_personal_uq
  ON public.live_event_sessions (live_event_id, starts_at, viewer_user_id)
  WHERE viewer_user_id IS NOT NULL;

-- Индексы для resolver/picker
CREATE INDEX IF NOT EXISTS idx_live_event_sessions_event_starts
  ON public.live_event_sessions (live_event_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_live_event_sessions_user_event
  ON public.live_event_sessions (viewer_user_id, live_event_id)
  WHERE viewer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_event_sessions_status_pending
  ON public.live_event_sessions (starts_at)
  WHERE status IN ('pending','live');

ALTER TABLE public.live_event_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: админы — full RW
DROP POLICY IF EXISTS "Admins manage live_event_sessions" ON public.live_event_sessions;
CREATE POLICY "Admins manage live_event_sessions"
  ON public.live_event_sessions
  FOR ALL
  TO authenticated
  USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

-- RLS: зритель видит свои персональные сессии + публичные scheduled, к эфиру которых имеет доступ
DROP POLICY IF EXISTS "Viewers read own and public sessions" ON public.live_event_sessions;
CREATE POLICY "Viewers read own and public sessions"
  ON public.live_event_sessions
  FOR SELECT
  TO authenticated
  USING (
    viewer_user_id = auth.uid()
    OR (
      viewer_user_id IS NULL
      AND user_has_live_event_access(auth.uid(), live_event_id)
    )
  );

-- RLS: staff (employee) видит всё
DROP POLICY IF EXISTS "Staff read all sessions" ON public.live_event_sessions;
CREATE POLICY "Staff read all sessions"
  ON public.live_event_sessions
  FOR SELECT
  TO authenticated
  USING (
    has_role_v2(auth.uid(),'employee')
    OR has_role_v2(auth.uid(),'admin')
    OR has_role_v2(auth.uid(),'super_admin')
  );

-- Триггер updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_live_event_sessions_touch ON public.live_event_sessions;
CREATE TRIGGER trg_live_event_sessions_touch
  BEFORE UPDATE ON public.live_event_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 3. live_event_timeline_events
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_event_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  offset_seconds integer NOT NULL CHECK (offset_seconds >= 0),
  kind text NOT NULL
    CHECK (kind IN ('cta_show','cta_hide','poll','resource_link','host_message','system_message','end_screen')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.live_event_timeline_events IS
  'Сценарные события автовебинара по таймкоду видео. ИЗОЛИРОВАНО от live_event_comments/questions — не загрязняет SoT.';

CREATE INDEX IF NOT EXISTS idx_timeline_events_event_offset
  ON public.live_event_timeline_events (live_event_id, offset_seconds)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_timeline_events_event
  ON public.live_event_timeline_events (live_event_id);

ALTER TABLE public.live_event_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage timeline_events" ON public.live_event_timeline_events;
CREATE POLICY "Admins manage timeline_events"
  ON public.live_event_timeline_events
  FOR ALL
  TO authenticated
  USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

-- Зритель с доступом к эфиру читает active timeline (для runtime-tick на клиенте)
DROP POLICY IF EXISTS "Viewers read active timeline" ON public.live_event_timeline_events;
CREATE POLICY "Viewers read active timeline"
  ON public.live_event_timeline_events
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND user_has_live_event_access(auth.uid(), live_event_id)
  );

DROP POLICY IF EXISTS "Staff read all timeline" ON public.live_event_timeline_events;
CREATE POLICY "Staff read all timeline"
  ON public.live_event_timeline_events
  FOR SELECT
  TO authenticated
  USING (
    has_role_v2(auth.uid(),'employee')
    OR has_role_v2(auth.uid(),'admin')
    OR has_role_v2(auth.uid(),'super_admin')
  );

DROP TRIGGER IF EXISTS trg_timeline_events_touch ON public.live_event_timeline_events;
CREATE TRIGGER trg_timeline_events_touch
  BEFORE UPDATE ON public.live_event_timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 4. live_event_session_progress
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_event_session_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.live_event_sessions(id) ON DELETE CASCADE,
  viewer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_proof_id uuid NULL,
  first_joined_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  completed_at timestamptz NULL,
  max_watched_seconds integer NOT NULL DEFAULT 0,
  watch_percent numeric(5,2) NOT NULL DEFAULT 0,
  last_video_position_seconds integer NOT NULL DEFAULT 0,
  cta_clicks jsonb NOT NULL DEFAULT '[]'::jsonb,
  poll_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.live_event_session_progress IS
  'Метрики просмотра автовебинара по сессии+зрителю. Источник для retention 25/50/75/100, last_video_position_seconds для resume_from_last_position.';

-- Уникальность по (session_id, viewer_user_id) когда user_id есть, иначе по proof_id
CREATE UNIQUE INDEX IF NOT EXISTS live_event_session_progress_user_uq
  ON public.live_event_session_progress (session_id, viewer_user_id)
  WHERE viewer_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS live_event_session_progress_proof_uq
  ON public.live_event_session_progress (session_id, viewer_proof_id)
  WHERE viewer_user_id IS NULL AND viewer_proof_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_progress_session
  ON public.live_event_session_progress (session_id);
CREATE INDEX IF NOT EXISTS idx_session_progress_user
  ON public.live_event_session_progress (viewer_user_id)
  WHERE viewer_user_id IS NOT NULL;

ALTER TABLE public.live_event_session_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage session_progress" ON public.live_event_session_progress;
CREATE POLICY "Admins manage session_progress"
  ON public.live_event_session_progress
  FOR ALL
  TO authenticated
  USING (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "Viewers read own progress" ON public.live_event_session_progress;
CREATE POLICY "Viewers read own progress"
  ON public.live_event_session_progress
  FOR SELECT
  TO authenticated
  USING (viewer_user_id = auth.uid());

-- INSERT/UPDATE собственного прогресса
DROP POLICY IF EXISTS "Viewers upsert own progress" ON public.live_event_session_progress;
CREATE POLICY "Viewers upsert own progress"
  ON public.live_event_session_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (viewer_user_id = auth.uid());

DROP POLICY IF EXISTS "Viewers update own progress" ON public.live_event_session_progress;
CREATE POLICY "Viewers update own progress"
  ON public.live_event_session_progress
  FOR UPDATE
  TO authenticated
  USING (viewer_user_id = auth.uid())
  WITH CHECK (viewer_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read all session_progress" ON public.live_event_session_progress;
CREATE POLICY "Staff read all session_progress"
  ON public.live_event_session_progress
  FOR SELECT
  TO authenticated
  USING (
    has_role_v2(auth.uid(),'employee')
    OR has_role_v2(auth.uid(),'admin')
    OR has_role_v2(auth.uid(),'super_admin')
  );

DROP TRIGGER IF EXISTS trg_session_progress_touch ON public.live_event_session_progress;
CREATE TRIGGER trg_session_progress_touch
  BEFORE UPDATE ON public.live_event_session_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 5. Контракт event_type расширяем (без CHECK ломки): добавляем 'autowebinar'
--    Текущий event_type — text без CHECK, поэтому INSERT 'autowebinar' уже валиден.
--    Добавим явный комментарий для будущих ревью.
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.live_events.event_type IS
  'Type: live_stream | recorded_webinar (one_time) | autowebinar (scheduled/just_in_time/on_demand — см. autoweb_mode)';