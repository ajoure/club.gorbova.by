-- Conference 5 of CB20 has an empty live_events.product_id. Keep the event
-- unchanged; permit only this dated, named historical source to bind to CB20.
CREATE OR REPLACE FUNCTION public.course_historical_event_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; e public.live_events;
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id = NEW.source_id FOR UPDATE;
  SELECT * INTO e FROM public.live_events WHERE id = NEW.live_event_id FOR SHARE;
  IF s.id IS NULL OR s.source_scope <> 'historical_live_event'
    OR e.id IS NULL
    OR NOT coalesce((
      e.product_id = NEW.product_id
      OR (
        e.product_id IS NULL
        AND NEW.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
        AND lower(btrim(e.title)) = 'цб 2.0 20 поток конференция 5'
        AND (e.scheduled_at AT TIME ZONE 'UTC')::date = '2026-09-13'::date
      )
    ), false)
    OR e.kinescope_live_event_id IS DISTINCT FROM NEW.provider_live_event_id
    OR e.kinescope_project_id IS DISTINCT FROM NEW.provider_project_id
    OR e.updated_at IS DISTINCT FROM NEW.event_updated_at
    OR EXISTS (SELECT 1 FROM public.course_transcription_bindings WHERE source_id = NEW.source_id)
    THEN RAISE EXCEPTION 'historical_event_binding_invalid'; END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.course_historical_event_binding_guard() FROM PUBLIC, anon, authenticated;