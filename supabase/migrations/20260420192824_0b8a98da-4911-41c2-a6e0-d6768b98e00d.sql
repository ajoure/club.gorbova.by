ALTER TABLE public.live_events
ADD COLUMN IF NOT EXISTS kinescope_instance_id TEXT;