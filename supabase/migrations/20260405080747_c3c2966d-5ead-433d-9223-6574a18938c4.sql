-- 1. Deactivate the live notifications cron job
SELECT cron.alter_job(42, active := false);

-- 2. Create global config singleton for live notifications
CREATE TABLE IF NOT EXISTS public.live_notification_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  proof_mode boolean NOT NULL DEFAULT true,
  production_approved boolean NOT NULL DEFAULT false,
  test_allowlist uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.live_notification_config ENABLE ROW LEVEL SECURITY;

-- Insert default row: kill-switch ON (enabled=false), proof_mode ON, production NOT approved
INSERT INTO public.live_notification_config (id, enabled, proof_mode, production_approved, test_allowlist)
VALUES (1, false, true, false, '{}')
ON CONFLICT (id) DO NOTHING;

-- RLS: only admins via has_role
CREATE POLICY "Admins can read live_notification_config"
  ON public.live_notification_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update live_notification_config"
  ON public.live_notification_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Extend live_event_notification_log with payload snapshot + incident fields
ALTER TABLE public.live_event_notification_log
  ADD COLUMN IF NOT EXISTS rendered_subject text,
  ADD COLUMN IF NOT EXISTS rendered_text text,
  ADD COLUMN IF NOT EXISTS rendered_button_text text,
  ADD COLUMN IF NOT EXISTS rendered_button_url text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_response jsonb,
  ADD COLUMN IF NOT EXISTS dispatch_mode text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS correction_of_log_id uuid REFERENCES public.live_event_notification_log(id),
  ADD COLUMN IF NOT EXISTS incident_batch_id text;

-- 4. Disable notifications on the problematic event
UPDATE public.live_events
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{notification_settings,enabled}',
  'false'::jsonb
)
WHERE id = '3dc1c789-9a63-43fd-92eb-1f0737e4266d';