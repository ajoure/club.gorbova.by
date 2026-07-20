-- Autoweb runtime: isolate new chat/questions by session, not only event.
-- Historical source-event reads remain read-only and use their existing policies.

CREATE OR REPLACE FUNCTION public.assert_autoweb_session_write(
  _live_event_id uuid,
  _session_id uuid,
  _actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _session_owner uuid;
BEGIN
  SELECT viewer_user_id
    INTO _session_owner
    FROM public.live_event_sessions
   WHERE id = _session_id
     AND live_event_id = _live_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'metadata.session_id does not belong to this live_event'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A personal session may only receive its owner's messages. Staff can use
  -- the same path for support/moderation; public scheduled sessions remain
  -- available to viewers who pass the normal event-access RLS policy.
  IF _session_owner IS NOT NULL
     AND _session_owner <> _actor_user_id
     AND NOT has_role_v2(_actor_user_id, 'admin')
     AND NOT has_role_v2(_actor_user_id, 'super_admin')
     AND NOT has_role_v2(_actor_user_id, 'employee') THEN
    RAISE EXCEPTION 'autoweb personal session belongs to another viewer'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_autoweb_session_id_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_session_id text;
BEGIN
  SELECT event_type INTO v_event_type FROM public.live_events WHERE id = NEW.live_event_id;
  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN RETURN NEW; END IF;

  v_session_id := NULLIF(NEW.metadata->>'session_id', '');
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar comments require metadata.session_id'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.assert_autoweb_session_write(NEW.live_event_id, v_session_id::uuid, auth.uid());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_autoweb_session_id_on_question()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_session_id text;
BEGIN
  SELECT event_type INTO v_event_type FROM public.live_events WHERE id = NEW.live_event_id;
  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN RETURN NEW; END IF;

  v_session_id := NULLIF(NEW.metadata->>'session_id', '');
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar questions require metadata.session_id'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.assert_autoweb_session_write(NEW.live_event_id, v_session_id::uuid, auth.uid());
  RETURN NEW;
END;
$$;

-- Existing comments policy was event-wide. For autowebinars a viewer must not
-- read other viewers' live messages; staff retain full moderation visibility.
DROP POLICY IF EXISTS "Users with access can read comments" ON public.live_event_comments;
CREATE POLICY "Users read isolated autoweb comments"
  ON public.live_event_comments
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_live_event_access(auth.uid(), live_event_id)
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.live_events e
         WHERE e.id = live_event_comments.live_event_id
           AND e.event_type = 'autowebinar'
      )
      OR live_event_comments.user_id = auth.uid()
      OR public.has_role_v2(auth.uid(), 'admin')
      OR public.has_role_v2(auth.uid(), 'super_admin')
      OR public.has_role_v2(auth.uid(), 'employee')
    )
  );

CREATE INDEX IF NOT EXISTS idx_live_event_comments_autoweb_session
  ON public.live_event_comments (live_event_id, ((metadata->>'session_id')), created_at DESC)
  WHERE metadata ? 'session_id';

CREATE INDEX IF NOT EXISTS idx_live_event_questions_autoweb_session
  ON public.live_event_questions (live_event_id, ((metadata->>'session_id')), created_at ASC)
  WHERE metadata ? 'session_id';
