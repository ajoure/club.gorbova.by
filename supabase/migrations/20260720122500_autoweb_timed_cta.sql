-- Timed CTA remains in the isolated scenario store; never in real chat tables.
ALTER TABLE public.autoweb_scenario_entries
  DROP CONSTRAINT IF EXISTS autoweb_scenario_entries_entry_type_check;
ALTER TABLE public.autoweb_scenario_entries
  ADD CONSTRAINT autoweb_scenario_entries_entry_type_check
  CHECK (entry_type IN ('chat','question','host_message','reaction','cta'));

CREATE OR REPLACE FUNCTION public.autoweb_scenario_runtime_list_v2(
  _session_id uuid, _live_event_id uuid
) RETURNS TABLE(id uuid, entry_type text, offset_seconds integer, actor_display_name text, content_text text, metadata jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id, e.entry_type, e.offset_seconds, e.actor_display_name, e.content_text, e.metadata
  FROM public.autoweb_scenario_entries e
  JOIN public.live_event_sessions s ON s.id = _session_id
  WHERE auth.uid() IS NOT NULL
    AND (public.is_room_staff(auth.uid()) OR (
      public.user_has_live_event_access(auth.uid(), s.live_event_id)
      AND (s.viewer_user_id IS NULL OR s.viewer_user_id = auth.uid())
    ))
    AND _live_event_id = s.live_event_id
    AND e.live_event_id = _live_event_id AND e.state = 'applied' AND e.visibility_scope = 'public'
  ORDER BY e.offset_seconds ASC, e.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_runtime_list_v2(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_runtime_list_v2(uuid, uuid) TO authenticated;
