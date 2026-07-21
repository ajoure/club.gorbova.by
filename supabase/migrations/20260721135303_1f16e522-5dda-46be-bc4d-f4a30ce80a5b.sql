-- Client-assisted transcription pipeline for long live-event recordings.
-- Two internal tables persist a job and its per-chunk parts so the browser tab
-- can resume after a reload and retry failed parts without redoing successful
-- ones. All writes happen through the transcription-client-worker edge
-- function under service_role; end users never touch these rows directly, but
-- admins and the assigned presenter can read them to render progress in the UI.

CREATE TABLE public.live_event_client_transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  audio_asset_id UUID NOT NULL REFERENCES public.live_event_audio_assets(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_parts',
  stage TEXT NOT NULL DEFAULT 'preparing',
  total_parts INTEGER NOT NULL DEFAULT 0,
  completed_parts INTEGER NOT NULL DEFAULT 0,
  failed_parts INTEGER NOT NULL DEFAULT 0,
  audio_duration_ms INTEGER,
  window_ms INTEGER NOT NULL DEFAULT 480000,
  error_code TEXT,
  error_message TEXT,
  heartbeat_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT live_event_client_transcription_jobs_status_check
    CHECK (status IN ('pending_parts','transcribing','finalizing','ready','failed','cancelled')),
  CONSTRAINT live_event_client_transcription_jobs_stage_check
    CHECK (stage IN ('preparing','uploading','transcribing','finalizing','ready','failed'))
);

CREATE UNIQUE INDEX live_event_client_transcription_jobs_active_unique
  ON public.live_event_client_transcription_jobs (live_event_id, audio_asset_id)
  WHERE status IN ('pending_parts','transcribing','finalizing');

CREATE INDEX live_event_client_transcription_jobs_live_event_idx
  ON public.live_event_client_transcription_jobs (live_event_id, created_at DESC);

GRANT SELECT ON public.live_event_client_transcription_jobs TO authenticated;
GRANT ALL ON public.live_event_client_transcription_jobs TO service_role;

ALTER TABLE public.live_event_client_transcription_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and event presenter can read transcription jobs"
  ON public.live_event_client_transcription_jobs
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.is_live_event_presenter(auth.uid(), live_event_id)
  );

CREATE POLICY "Service role manages transcription jobs"
  ON public.live_event_client_transcription_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


CREATE TABLE public.live_event_client_transcription_job_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.live_event_client_transcription_jobs(id) ON DELETE CASCADE,
  part_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER,
  error_code TEXT,
  error_message TEXT,
  transcribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT live_event_client_transcription_job_parts_status_check
    CHECK (status IN ('pending','uploading','ready','failed')),
  CONSTRAINT live_event_client_transcription_job_parts_unique_index
    UNIQUE (job_id, part_index)
);

CREATE INDEX live_event_client_transcription_job_parts_job_idx
  ON public.live_event_client_transcription_job_parts (job_id, part_index);

GRANT SELECT ON public.live_event_client_transcription_job_parts TO authenticated;
GRANT ALL ON public.live_event_client_transcription_job_parts TO service_role;

ALTER TABLE public.live_event_client_transcription_job_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and event presenter can read transcription job parts"
  ON public.live_event_client_transcription_job_parts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.live_event_client_transcription_jobs j
      WHERE j.id = live_event_client_transcription_job_parts.job_id
        AND (
          public.has_role_v2(auth.uid(), 'admin')
          OR public.has_role_v2(auth.uid(), 'super_admin')
          OR public.is_live_event_presenter(auth.uid(), j.live_event_id)
        )
    )
  );

CREATE POLICY "Service role manages transcription job parts"
  ON public.live_event_client_transcription_job_parts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


CREATE OR REPLACE FUNCTION public.set_live_event_client_transcription_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER live_event_client_transcription_jobs_set_updated_at
  BEFORE UPDATE ON public.live_event_client_transcription_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_live_event_client_transcription_jobs_updated_at();

CREATE TRIGGER live_event_client_transcription_job_parts_set_updated_at
  BEFORE UPDATE ON public.live_event_client_transcription_job_parts
  FOR EACH ROW EXECUTE FUNCTION public.set_live_event_client_transcription_jobs_updated_at();