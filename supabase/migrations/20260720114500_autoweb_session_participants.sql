-- Autoweb participants are derived from real playback progress in one session.
-- Do not reuse live_active_sessions: it aggregates the whole event and would
-- mix parallel scheduled/JIT/on-demand launches.

CREATE OR REPLACE FUNCTION public.get_autoweb_session_participants(_session_id uuid)
RETURNS TABLE(
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
SET search_path TO 'public'
AS $$
DECLARE
  _viewer uuid := auth.uid();
  _event_id uuid;
  _session_owner uuid;
  _is_staff boolean := false;
BEGIN
  IF _viewer IS NULL THEN RETURN; END IF;

  SELECT live_event_id, viewer_user_id
    INTO _event_id, _session_owner
    FROM public.live_event_sessions
   WHERE id = _session_id;
  IF NOT FOUND THEN RETURN; END IF;

  _is_staff := public.is_room_staff(_viewer);
  IF NOT _is_staff AND (
    NOT public.user_has_live_event_access(_viewer, _event_id)
    OR (_session_owner IS NOT NULL AND _session_owner <> _viewer)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.viewer_user_id AS user_id,
    COALESCE(pref.display_name, 'Гость') AS display_name,
    pref.nickname_color,
    COALESCE(pref.show_avatar, false) AS show_avatar,
    CASE
      WHEN _is_staff OR COALESCE(pref.show_avatar, false) THEN profile.avatar_url
      ELSE NULL
    END AS avatar_url,
    CASE WHEN _is_staff THEN COALESCE(
      NULLIF(TRIM(profile.full_name), ''),
      NULLIF(TRIM(CONCAT_WS(' ', profile.first_name, profile.last_name)), ''),
      profile.email
    ) ELSE NULL END AS real_name_for_staff,
    CASE
      WHEN public.has_role_v2(p.viewer_user_id, 'super_admin')
        OR public.has_role_v2(p.viewer_user_id, 'admin') THEN 'admin'
      WHEN public.has_role_v2(p.viewer_user_id, 'employee') THEN 'staff'
      ELSE 'user'
    END AS role_in_room,
    p.last_seen_at
  FROM public.live_event_session_progress p
  LEFT JOIN public.live_event_participant_prefs pref
    ON pref.live_event_id = _event_id AND pref.user_id = p.viewer_user_id
  LEFT JOIN public.profiles profile ON profile.user_id = p.viewer_user_id
  WHERE p.session_id = _session_id
    AND p.viewer_user_id IS NOT NULL
    AND p.last_seen_at > now() - interval '2 minutes'
  ORDER BY p.last_seen_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_autoweb_session_participants(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_autoweb_session_participants(uuid) TO authenticated;
