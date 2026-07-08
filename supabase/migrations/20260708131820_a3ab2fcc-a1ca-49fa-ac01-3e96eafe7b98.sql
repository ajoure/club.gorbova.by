ALTER TABLE public.live_events
  ADD COLUMN IF NOT EXISTS source_live_event_id uuid NULL
    REFERENCES public.live_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_live_events_source_live_event_id
  ON public.live_events (source_live_event_id)
  WHERE source_live_event_id IS NOT NULL;

COMMENT ON COLUMN public.live_events.source_live_event_id IS
  'For event_type in (autowebinar, recorded_webinar): link to the original live_stream event whose kinescope video is being replayed. Used to source historical comments/questions/participants/scenario for timed-replay. NULL = no source (legacy or standalone).';