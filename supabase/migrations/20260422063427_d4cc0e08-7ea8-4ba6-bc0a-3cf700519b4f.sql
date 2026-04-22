
-- ============================================================
-- PHASE 1.1 — live_event_participant_prefs (per-event identity)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.live_event_participant_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text,
  nickname_color text,
  show_avatar boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (live_event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lepp_event_user
  ON public.live_event_participant_prefs (live_event_id, user_id);

ALTER TABLE public.live_event_participant_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own prefs"
  ON public.live_event_participant_prefs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Staff read all prefs"
  ON public.live_event_participant_prefs
  FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'employee')
  );

CREATE POLICY "Users insert own prefs"
  ON public.live_event_participant_prefs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
  );

CREATE POLICY "Users update own prefs"
  ON public.live_event_participant_prefs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- PHASE 1.2 — Расширение live_active_sessions (runtime mirror)
-- ============================================================
ALTER TABLE public.live_active_sessions
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS nickname_color text,
  ADD COLUMN IF NOT EXISTS show_avatar boolean NOT NULL DEFAULT false;

-- ============================================================
-- PHASE 1.3 — Snapshot цвета ника в comments/questions
-- author_display_name + author_avatar_url уже есть; добавляем color
-- ============================================================
ALTER TABLE public.live_event_comments
  ADD COLUMN IF NOT EXISTS author_nickname_color text;

ALTER TABLE public.live_event_questions
  ADD COLUMN IF NOT EXISTS author_nickname_color text;

-- ============================================================
-- PHASE 1.4 — Server guard для staff-only цветов
-- Reserved palette: красный (#ef4444 и его варианты)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_staff_reserved_color(_color text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_color, '')) = ANY (ARRAY[
    '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
    '#ff0000', 'red'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.guard_participant_prefs_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.nickname_color IS NOT NULL
     AND public.is_staff_reserved_color(NEW.nickname_color)
     AND NOT (
       public.has_role_v2(auth.uid(), 'admin')
       OR public.has_role_v2(auth.uid(), 'employee')
     )
  THEN
    RAISE EXCEPTION 'nickname_color "%" is reserved for staff', NEW.nickname_color
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_participant_prefs_color ON public.live_event_participant_prefs;
CREATE TRIGGER trg_guard_participant_prefs_color
  BEFORE INSERT OR UPDATE OF nickname_color ON public.live_event_participant_prefs
  FOR EACH ROW EXECUTE FUNCTION public.guard_participant_prefs_color();

-- Тот же guard для runtime-зеркала в live_active_sessions
CREATE OR REPLACE FUNCTION public.guard_active_session_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.nickname_color IS NOT NULL
     AND public.is_staff_reserved_color(NEW.nickname_color)
     AND NOT (
       public.has_role_v2(auth.uid(), 'admin')
       OR public.has_role_v2(auth.uid(), 'employee')
     )
  THEN
    RAISE EXCEPTION 'nickname_color "%" is reserved for staff', NEW.nickname_color
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_session_color ON public.live_active_sessions;
CREATE TRIGGER trg_guard_active_session_color
  BEFORE INSERT OR UPDATE OF nickname_color ON public.live_active_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_session_color();

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_lepp_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lepp_updated_at ON public.live_event_participant_prefs;
CREATE TRIGGER trg_lepp_updated_at
  BEFORE UPDATE ON public.live_event_participant_prefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_lepp_set_updated_at();

-- ============================================================
-- PHASE 1.5 — live_event_reactions (отдельный слой)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.live_event_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ler_event_created
  ON public.live_event_reactions (live_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ler_user_event_recent
  ON public.live_event_reactions (user_id, live_event_id, created_at DESC);

ALTER TABLE public.live_event_reactions ENABLE ROW LEVEL SECURITY;

-- Rate-limit функция: не более 10 реакций в минуту от одного пользователя
CREATE OR REPLACE FUNCTION public.can_send_reaction(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (
    SELECT count(*)
    FROM public.live_event_reactions
    WHERE user_id = _user_id
      AND live_event_id = _event_id
      AND created_at > now() - interval '1 minute'
  ) < 10;
$$;

CREATE POLICY "Users read reactions for accessible events"
  ON public.live_event_reactions
  FOR SELECT TO authenticated
  USING (user_has_live_event_access(auth.uid(), live_event_id));

CREATE POLICY "Users insert own reactions with rate limit"
  ON public.live_event_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
    AND NOT is_user_muted_in_room(auth.uid(), live_event_id)
    AND can_send_reaction(auth.uid(), live_event_id)
  );

CREATE POLICY "Admins manage reactions"
  ON public.live_event_reactions
  FOR ALL TO authenticated
  USING (has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (has_role_v2(auth.uid(), 'admin'));

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_reactions;
ALTER TABLE public.live_event_reactions REPLICA IDENTITY FULL;

-- ============================================================
-- PHASE 1.6 — RPC get_room_participants (единственный публичный канал)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_room_participants(_event_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  nickname_color text,
  show_avatar boolean,
  avatar_url text,
  real_name_for_staff text,
  role_in_room text,
  last_seen_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _viewer uuid := auth.uid();
  _is_staff boolean := false;
BEGIN
  -- Доступ только для пользователей с доступом к эфиру
  IF _viewer IS NULL OR NOT user_has_live_event_access(_viewer, _event_id) THEN
    RETURN;
  END IF;

  _is_staff := has_role_v2(_viewer, 'admin') OR has_role_v2(_viewer, 'employee');

  RETURN QUERY
  WITH active AS (
    SELECT DISTINCT ON (s.user_id)
      s.user_id,
      s.display_name AS sess_name,
      s.nickname_color AS sess_color,
      s.show_avatar AS sess_show_avatar,
      s.last_seen_at
    FROM public.live_active_sessions s
    WHERE s.live_event_id = _event_id
      AND s.expires_at > now()
      AND s.last_seen_at > now() - interval '2 minutes'
      AND s.revoked_at IS NULL
    ORDER BY s.user_id, s.last_seen_at DESC
  )
  SELECT
    a.user_id,
    -- display_name: приоритет sessions → prefs → 'Гость'
    coalesce(a.sess_name, p.display_name, 'Гость')::text AS display_name,
    coalesce(a.sess_color, p.nickname_color)::text AS nickname_color,
    coalesce(a.sess_show_avatar, p.show_avatar, false)::boolean AS show_avatar,
    -- avatar_url: только если show_avatar=true ИЛИ зритель — staff
    CASE
      WHEN coalesce(a.sess_show_avatar, p.show_avatar, false) OR _is_staff
        THEN pr.avatar_url
      ELSE NULL
    END::text AS avatar_url,
    -- real_name_for_staff: только staff
    CASE WHEN _is_staff THEN pr.full_name ELSE NULL END::text AS real_name_for_staff,
    -- role_in_room
    CASE
      WHEN has_role_v2(a.user_id, 'admin') THEN 'admin'
      WHEN has_role_v2(a.user_id, 'employee') THEN 'employee'
      ELSE 'user'
    END::text AS role_in_room,
    a.last_seen_at
  FROM active a
  LEFT JOIN public.live_event_participant_prefs p
    ON p.live_event_id = _event_id AND p.user_id = a.user_id
  LEFT JOIN public.profiles pr
    ON pr.user_id = a.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_participants(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_room_participants(uuid) TO authenticated;

-- ============================================================
-- PHASE 1.7 — Storage bucket для pre-start ассетов
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('webinar-prestart', 'webinar-prestart', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read webinar-prestart"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'webinar-prestart');

CREATE POLICY "Admins manage webinar-prestart"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'webinar-prestart'
    AND has_role_v2(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id = 'webinar-prestart'
    AND has_role_v2(auth.uid(), 'admin')
  );
