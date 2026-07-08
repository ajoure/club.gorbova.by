-- 1) Расширяем check-constraint autoweb_mode, чтобы включить one_time.
ALTER TABLE public.live_events
  DROP CONSTRAINT IF EXISTS live_events_autoweb_mode_check;

ALTER TABLE public.live_events
  ADD CONSTRAINT live_events_autoweb_mode_check
  CHECK (
    autoweb_mode IS NULL
    OR autoweb_mode = ANY (ARRAY['one_time'::text, 'scheduled'::text, 'just_in_time'::text, 'on_demand'::text])
  );

-- 2) Точечный data-fix одного проблемного эфира (согласовано).
UPDATE public.live_events
SET
  event_type = 'autowebinar',
  autoweb_mode = 'one_time',
  source_kind = 'kinescope_video',
  source_live_event_id = '81f286d7-887e-4ed2-b0f0-0a8f5c9eb817',
  updated_at = now()
WHERE id = '91d97e72-c96a-4911-bb79-cfdc834c3a8b'
  AND event_type = 'recorded_webinar';