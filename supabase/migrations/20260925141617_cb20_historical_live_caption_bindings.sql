-- A private transcript may document a past live event without making it a
-- course lesson or a claim about access to the next cohort.
ALTER TABLE public.course_transcription_sources
  ADD COLUMN source_scope text NOT NULL DEFAULT 'course'
  CHECK (source_scope IN ('course', 'historical_live_event'));

CREATE TABLE public.course_historical_event_bindings (
  source_id uuid PRIMARY KEY REFERENCES public.course_transcription_sources(id),
  live_event_id uuid NOT NULL UNIQUE REFERENCES public.live_events(id),
  product_id uuid NOT NULL REFERENCES public.products_v2(id),
  provider_live_event_id text NOT NULL,
  provider_project_id text NOT NULL,
  event_updated_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.course_historical_event_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; e public.live_events;
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id = NEW.source_id FOR UPDATE;
  SELECT * INTO e FROM public.live_events WHERE id = NEW.live_event_id FOR SHARE;
  IF s.id IS NULL OR s.source_scope <> 'historical_live_event'
    OR e.id IS NULL OR e.product_id IS DISTINCT FROM NEW.product_id
    OR e.kinescope_live_event_id IS DISTINCT FROM NEW.provider_live_event_id
    OR e.kinescope_project_id IS DISTINCT FROM NEW.provider_project_id
    OR e.updated_at IS DISTINCT FROM NEW.event_updated_at
    OR EXISTS (SELECT 1 FROM public.course_transcription_bindings WHERE source_id = NEW.source_id)
    THEN RAISE EXCEPTION 'historical_event_binding_invalid'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER course_historical_event_binding_guard
BEFORE INSERT OR UPDATE ON public.course_historical_event_bindings
FOR EACH ROW EXECUTE FUNCTION public.course_historical_event_binding_guard();

CREATE FUNCTION public.course_lesson_source_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.course_transcription_sources
    WHERE id = NEW.source_id AND source_scope = 'course' FOR UPDATE)
    THEN RAISE EXCEPTION 'historical_source_not_course_lesson'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER course_lesson_source_scope_guard
BEFORE INSERT OR UPDATE ON public.course_transcription_bindings
FOR EACH ROW EXECUTE FUNCTION public.course_lesson_source_scope_guard();

CREATE FUNCTION public.course_source_scope_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.source_scope IS DISTINCT FROM OLD.source_scope
    THEN RAISE EXCEPTION 'source_scope_immutable'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER course_source_scope_immutable
BEFORE UPDATE OF source_scope ON public.course_transcription_sources
FOR EACH ROW EXECUTE FUNCTION public.course_source_scope_immutable();

REVOKE ALL ON FUNCTION public.course_historical_event_binding_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.course_lesson_source_scope_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.course_source_scope_immutable() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.course_historical_event_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_historical_event_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_historical_event_bindings TO authenticated;
GRANT ALL ON public.course_historical_event_bindings TO service_role;
CREATE POLICY owner_read ON public.course_historical_event_bindings
  FOR SELECT TO authenticated
  USING (public.has_role_v2((SELECT auth.uid()), 'super_admin'));
