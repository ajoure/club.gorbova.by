CREATE OR REPLACE FUNCTION public.get_room_participants(_event_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, nickname_color text, show_avatar boolean, avatar_url text, real_name_for_staff text, role_in_room text, last_seen_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    CASE
      WHEN _is_staff THEN pr.avatar_url
      WHEN COALESCE(p.show_avatar, false) THEN pr.avatar_url
      ELSE NULL
    END AS avatar_url,
    CASE
      WHEN _is_staff THEN COALESCE(
        NULLIF(TRIM(pr.full_name), ''),
        NULLIF(TRIM(CONCAT_WS(' ', pr.first_name, pr.last_name)), ''),
        pr.email
      )
      ELSE NULL
    END AS real_name_for_staff,
    -- FIX: role_in_room derived from user_roles_v2 (no schema change to live_active_sessions)
    COALESCE((
      SELECT CASE
        WHEN bool_or(r.code IN ('super_admin','admin')) THEN 'admin'
        WHEN bool_or(r.code IN ('admin_gost','support','editor','news_editor')) THEN 'staff'
        ELSE 'user'
      END
      FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = s.user_id
    ), 'user') AS role_in_room,
    s.last_seen_at
  FROM public.live_active_sessions s
  LEFT JOIN public.live_event_participant_prefs p
    ON p.live_event_id = s.live_event_id AND p.user_id = s.user_id
  LEFT JOIN public.profiles pr ON pr.user_id = s.user_id
  WHERE s.live_event_id = _event_id
    AND s.last_seen_at > now() - interval '2 minutes';
END;
$function$;