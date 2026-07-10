
ALTER TABLE public.provider_events
  DROP CONSTRAINT IF EXISTS provider_events_provider_check;
ALTER TABLE public.provider_events
  ADD CONSTRAINT provider_events_provider_check
  CHECK (provider = ANY (ARRAY['stripe'::text, 'bepaid'::text, 'rr'::text]));

ALTER TABLE public.provider_events
  DROP CONSTRAINT IF EXISTS provider_events_processing_status_check;
ALTER TABLE public.provider_events
  ADD CONSTRAINT provider_events_processing_status_check
  CHECK (processing_status = ANY (ARRAY[
    'received'::text, 'processed'::text, 'skipped_duplicate'::text,
    'failed'::text, 'manual_review'::text,
    'pending'::text, 'acknowledged'::text, 'rejected'::text, 'ignored'::text
  ]));

ALTER TABLE public.provider_events
  ALTER COLUMN account_code SET DEFAULT '';
