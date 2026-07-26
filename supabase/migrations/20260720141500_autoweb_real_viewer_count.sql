-- The real audience counter is intentionally derived from the same playback
-- heartbeat data as the session participants list. It never creates synthetic
-- sessions and is only callable by server-side code.

CREATE OR REPLACE FUNCTION public.autoweb_session_real_viewer_count(_session_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
  FROM public.live_event_session_progress p
  WHERE p.session_id = _session_id
    AND p.viewer_user_id IS NOT NULL
    AND p.last_seen_at > now() - interval '2 minutes'
    -- Staff and technical room opens must not inflate the actual audience.
    AND NOT public.is_room_staff(p.viewer_user_id);
$$;

REVOKE ALL ON FUNCTION public.autoweb_session_real_viewer_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_session_real_viewer_count(uuid) TO service_role;
