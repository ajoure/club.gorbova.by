CREATE OR REPLACE FUNCTION public.autoweb_history_comments_list(
  _session_id uuid, _source_event_id uuid
) RETURNS TABLE(
  id uuid, user_id uuid, content text, created_at timestamptz,
  author_display_name text, author_role text, author_avatar_url text, author_nickname_color text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.id, c.user_id, c.content, c.created_at,
    c.author_display_name, c.author_role, c.author_avatar_url, c.author_nickname_color
  FROM public.live_event_comments c
  JOIN public.live_event_sessions s ON s.id = _session_id
  JOIN public.live_events e ON e.id = s.live_event_id
  WHERE c.live_event_id = _source_event_id
    AND e.source_live_event_id = _source_event_id
    AND auth.uid() IS NOT NULL
    AND (
      public.is_room_staff(auth.uid())
      OR (
        public.user_has_live_event_access(auth.uid(), s.live_event_id)
        AND (s.viewer_user_id IS NULL OR s.viewer_user_id = auth.uid())
      )
    )
  ORDER BY c.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.autoweb_history_questions_list(
  _session_id uuid, _source_event_id uuid
) RETURNS TABLE(
  id uuid, user_id uuid, content text, is_answered boolean,
  answered_at timestamptz, answered_by uuid, created_at timestamptz,
  author_display_name text, author_role text, author_avatar_url text, author_nickname_color text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT q.id, q.user_id, q.content, q.is_answered, q.answered_at, q.answered_by,
    q.created_at, q.author_display_name, q.author_role, q.author_avatar_url, q.author_nickname_color
  FROM public.live_event_questions q
  JOIN public.live_event_sessions s ON s.id = _session_id
  JOIN public.live_events e ON e.id = s.live_event_id
  WHERE q.live_event_id = _source_event_id
    AND e.source_live_event_id = _source_event_id
    AND auth.uid() IS NOT NULL
    AND (
      public.is_room_staff(auth.uid())
      OR (
        public.user_has_live_event_access(auth.uid(), s.live_event_id)
        AND (s.viewer_user_id IS NULL OR s.viewer_user_id = auth.uid())
      )
    )
  ORDER BY q.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.autoweb_history_comments_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.autoweb_history_questions_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_history_comments_list(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autoweb_history_questions_list(uuid, uuid) TO authenticated;