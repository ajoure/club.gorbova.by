ALTER TABLE public.live_event_sessions
  DROP CONSTRAINT IF EXISTS live_event_sessions_mode_check;

ALTER TABLE public.live_event_sessions
  ADD CONSTRAINT live_event_sessions_mode_check
  CHECK (mode = ANY (ARRAY['one_time'::text, 'scheduled'::text, 'just_in_time'::text, 'on_demand'::text]));