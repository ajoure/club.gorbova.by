-- ============================================================
-- Запуск 1.1: privacy-aware snapshot + staff-checks с super_admin
-- ============================================================

-- 1. Helper: единая проверка staff (admin | super_admin | employee/admin_gost)
CREATE OR REPLACE FUNCTION public.is_room_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code IN ('super_admin', 'admin', 'admin_gost')
  );
$$;

-- 2. Privacy-aware snapshot для live_event_comments + live_event_questions
CREATE OR REPLACE FUNCTION public.snapshot_author_display_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  _prefs RECORD;
  _profile RECORD;
  _role_code text;
  _final_role text := 'user';
  _final_name text;
  _final_avatar text;
  _final_color text;
BEGIN
  -- 2.1 Определяем роль автора (super_admin > admin > admin_gost > user)
  SELECT r.code INTO _role_code
  FROM public.user_roles_v2 ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = NEW.user_id
    AND r.code IN ('super_admin', 'admin', 'admin_gost')
  ORDER BY CASE r.code
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'admin_gost' THEN 3
  END
  LIMIT 1;

  _final_role := CASE
    WHEN _role_code IN ('super_admin', 'admin') THEN 'admin'
    WHEN _role_code = 'admin_gost' THEN 'employee'
    ELSE 'user'
  END;

  -- 2.2 Источник истины #1 — per-event prefs
  SELECT display_name, nickname_color, show_avatar
  INTO _prefs
  FROM public.live_event_participant_prefs
  WHERE live_event_id = NEW.live_event_id
    AND user_id = NEW.user_id
  LIMIT 1;

  -- 2.3 Источник истины #2 — profiles (для аватара и fallback-имени)
  SELECT full_name, first_name, last_name, avatar_url, email
  INTO _profile
  FROM public.profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  -- 2.4 Финальное имя: prefs.display_name > existing snapshot > profile fallback > placeholder
  _final_name := COALESCE(
    NULLIF(TRIM(_prefs.display_name), ''),
    NULLIF(TRIM(NEW.author_display_name), ''),
    NULLIF(TRIM(_profile.full_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', _profile.first_name, _profile.last_name)), ''),
    CASE WHEN _profile.email IS NOT NULL AND _profile.email != ''
      THEN CONCAT(LEFT(_profile.email, 3), '***')
      ELSE NULL
    END,
    'Пользователь'
  );

  -- 2.5 Финальный цвет: prefs > metadata override > NULL
  _final_color := COALESCE(
    NULLIF(TRIM(_prefs.nickname_color), ''),
    NULLIF(TRIM(NEW.author_nickname_color), ''),
    NULLIF(TRIM(NEW.metadata->>'nickname_color'), '')
  );

  -- 2.6 КРИТИЧНО: avatar контракт.
  -- Если prefs.show_avatar = false → NULL всегда (privacy guard)
  -- Если prefs.show_avatar = true → берём profiles.avatar_url
  -- Если prefs нет (legacy/scripted) → не трогаем то, что прислали явно; иначе NULL
  IF _prefs.show_avatar IS TRUE THEN
    _final_avatar := _profile.avatar_url;
  ELSIF _prefs.show_avatar IS FALSE THEN
    _final_avatar := NULL;  -- HARD privacy guard
  ELSE
    -- prefs не существует: оставляем явно переданный (для scripted/host messages),
    -- но НЕ тянем profiles.avatar_url автоматически
    _final_avatar := NEW.author_avatar_url;
  END IF;

  -- 2.7 Применяем
  NEW.author_display_name := _final_name;
  NEW.author_avatar_url   := _final_avatar;
  NEW.author_nickname_color := _final_color;
  NEW.author_role         := _final_role;

  RETURN NEW;
END;
$function$;

-- 3. Убедимся, что триггер есть на questions (если ещё не создан)
DROP TRIGGER IF EXISTS trg_snapshot_question_author ON public.live_event_questions;
CREATE TRIGGER trg_snapshot_question_author
  BEFORE INSERT ON public.live_event_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_author_display_name();

-- 4. Обновить get_room_participants: добавить super_admin к staff-checks
CREATE OR REPLACE FUNCTION public.get_room_participants(_event_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  nickname_color text,
  show_avatar boolean,
  avatar_url text,
  real_name_for_staff text,
  role_in_room text,
  last_seen_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _viewer uuid := auth.uid();
  _is_staff boolean := false;
BEGIN
  IF _viewer IS NULL OR NOT user_has_live_event_access(_viewer, _event_id) THEN
    RETURN;
  END IF;

  _is_staff := public.is_room_staff(_viewer);

  RETURN QUERY
  SELECT
    s.user_id,
    COALESCE(p.display_name, 'Гость') AS display_name,
    p.nickname_color,
    COALESCE(p.show_avatar, false) AS show_avatar,
    -- Public avatar gate: student видит avatar только если show_avatar=true.
    -- Staff видит реальный аватар всегда (internal augmentation).
    CASE
      WHEN _is_staff THEN pr.avatar_url
      WHEN COALESCE(p.show_avatar, false) THEN pr.avatar_url
      ELSE NULL
    END AS avatar_url,
    -- Real name только для staff
    CASE
      WHEN _is_staff THEN COALESCE(
        NULLIF(TRIM(pr.full_name), ''),
        NULLIF(TRIM(CONCAT_WS(' ', pr.first_name, pr.last_name)), ''),
        pr.email
      )
      ELSE NULL
    END AS real_name_for_staff,
    COALESCE(s.role_in_room, 'user') AS role_in_room,
    s.last_seen_at
  FROM public.live_active_sessions s
  LEFT JOIN public.live_event_participant_prefs p
    ON p.live_event_id = s.live_event_id AND p.user_id = s.user_id
  LEFT JOIN public.profiles pr ON pr.user_id = s.user_id
  WHERE s.live_event_id = _event_id
    AND s.last_seen_at > now() - interval '2 minutes';
END;
$function$;

-- 5. Расширить RLS на live_event_participant_prefs: super_admin к staff
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='live_event_participant_prefs' AND policyname='Staff can read all prefs') THEN
    DROP POLICY "Staff can read all prefs" ON public.live_event_participant_prefs;
  END IF;
END $$;

CREATE POLICY "Staff can read all prefs"
  ON public.live_event_participant_prefs
  FOR SELECT
  TO authenticated
  USING (public.is_room_staff(auth.uid()));

-- 6. Расширить RLS на live_event_reactions: super_admin к staff (если есть staff-policy)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='live_event_reactions' AND policyname='Staff can manage reactions') THEN
    DROP POLICY "Staff can manage reactions" ON public.live_event_reactions;
  END IF;
END $$;

CREATE POLICY "Staff can manage reactions"
  ON public.live_event_reactions
  FOR ALL
  TO authenticated
  USING (public.is_room_staff(auth.uid()))
  WITH CHECK (public.is_room_staff(auth.uid()));

-- 7. Storage policies для webinar-prestart: write только admin/super_admin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='webinar_prestart_admin_write') THEN
    DROP POLICY "webinar_prestart_admin_write" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='webinar_prestart_admin_update') THEN
    DROP POLICY "webinar_prestart_admin_update" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='webinar_prestart_admin_delete') THEN
    DROP POLICY "webinar_prestart_admin_delete" ON storage.objects;
  END IF;
END $$;

CREATE POLICY "webinar_prestart_admin_write"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'webinar-prestart'
    AND EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "webinar_prestart_admin_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'webinar-prestart'
    AND EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "webinar_prestart_admin_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'webinar-prestart'
    AND EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('super_admin', 'admin')
    )
  );

COMMENT ON FUNCTION public.snapshot_author_display_name() IS
  'Privacy-aware snapshot: prefs-first для имени/цвета, hard NULL для avatar при show_avatar=false. Источник истины — live_event_participant_prefs.';

COMMENT ON FUNCTION public.is_room_staff(uuid) IS
  'Единый staff-check для вебинарной комнаты: super_admin | admin | admin_gost (employee).';