
-- Sprint B: server-side enforcement of metadata.session_id for autowebinar comments/questions.
-- Add-only: triggers reject inserts that violate the contract; legacy event types untouched.

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
  SELECT event_type INTO v_event_type
  FROM public.live_events
  WHERE id = NEW.live_event_id;

  -- Only enforce for autowebinar event_type. Legacy (live_stream / recorded_webinar) is unchanged.
  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN
    RETURN NEW;
  END IF;

  v_session_id := NULLIF(NEW.metadata->>'session_id', '');

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar comments require metadata.session_id'
      USING ERRCODE = 'check_violation',
            HINT = 'Pass session_id in metadata for autowebinar comments';
  END IF;

  -- Validate that session belongs to the same live_event (defensive ID-first check).
  PERFORM 1 FROM public.live_event_sessions
  WHERE id = v_session_id::uuid AND live_event_id = NEW.live_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'metadata.session_id does not belong to this live_event'
      USING ERRCODE = 'check_violation';
  END IF;

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
  SELECT event_type INTO v_event_type
  FROM public.live_events
  WHERE id = NEW.live_event_id;

  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN
    RETURN NEW;
  END IF;

  v_session_id := NULLIF(NEW.metadata->>'session_id', '');

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar questions require metadata.session_id'
      USING ERRCODE = 'check_violation',
            HINT = 'Pass session_id in metadata for autowebinar questions';
  END IF;

  PERFORM 1 FROM public.live_event_sessions
  WHERE id = v_session_id::uuid AND live_event_id = NEW.live_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'metadata.session_id does not belong to this live_event'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_autoweb_session_id_comments ON public.live_event_comments;
CREATE TRIGGER trg_enforce_autoweb_session_id_comments
BEFORE INSERT ON public.live_event_comments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_autoweb_session_id_on_comment();

DROP TRIGGER IF EXISTS trg_enforce_autoweb_session_id_questions ON public.live_event_questions;
CREATE TRIGGER trg_enforce_autoweb_session_id_questions
BEFORE INSERT ON public.live_event_questions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_autoweb_session_id_on_question();

COMMENT ON FUNCTION public.enforce_autoweb_session_id_on_comment IS
  'Sprint B: requires metadata.session_id for inserts on autowebinar event_type. Legacy event types untouched.';
COMMENT ON FUNCTION public.enforce_autoweb_session_id_on_question IS
  'Sprint B: requires metadata.session_id for inserts on autowebinar event_type. Legacy event types untouched.';
