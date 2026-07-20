-- Safe viewer read path for applied scripted scenario entries.
-- It returns render-only data and never writes into live chat/questions.

CREATE OR REPLACE FUNCTION public.autoweb_scenario_runtime_list(
  _session_id uuid,
  _live_event_id uuid
)
RETURNS TABLE(
  id uuid,
  entry_type text,
  offset_seconds integer,
  actor_display_name text,
  content_text text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _viewer uuid := auth.uid();
  _session_event_id uuid;
  _session_owner uuid;
  _is_staff boolean := false;
BEGIN
  IF _viewer IS NULL THEN RETURN; END IF;
  SELECT live_event_id, viewer_user_id
    INTO _session_event_id, _session_owner
    FROM public.live_event_sessions
   WHERE id = _session_id;
  IF NOT FOUND THEN RETURN; END IF;

  _is_staff := public.is_room_staff(_viewer);
  IF NOT _is_staff AND (
    NOT public.user_has_live_event_access(_viewer, _session_event_id)
    OR (_session_owner IS NOT NULL AND _session_owner <> _viewer)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.id, e.entry_type, e.offset_seconds, e.actor_display_name, e.content_text
    FROM public.autoweb_scenario_entries e
   WHERE e.live_event_id = _live_event_id
     AND e.state = 'applied'
     AND e.visibility_scope = 'public'
   ORDER BY e.offset_seconds ASC, e.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_runtime_list(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_runtime_list(uuid, uuid) TO authenticated;
