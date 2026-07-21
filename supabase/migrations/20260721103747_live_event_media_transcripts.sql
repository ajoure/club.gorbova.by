-- ============================================================================
-- Live-event media: one imported Kinescope audio track + one DOCX transcript.
--
-- The broadcast is recorded only once by Kinescope. We keep a private copy of
-- its resulting audio track so a presenter/admin can download it and run a
-- durable transcription even if the provider link later expires.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'live-event-media',
  'live-event-media',
  false,
  1073741824,
  ARRAY[
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav',
    'video/mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = GREATEST(COALESCE(storage.buckets.file_size_limit, 0), EXCLUDED.file_size_limit),
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.live_event_audio_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  source_video_id text NOT NULL,
  source_track_id text NOT NULL,
  source_language text,
  source_file_name text,
  source_file_type text,
  source_file_size bigint,
  storage_bucket text NOT NULL DEFAULT 'live-event-media',
  storage_path text,
  mime_type text,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'copying', 'ready', 'no_audio', 'failed')),
  error_code text,
  error_message text,
  copied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (live_event_id, source_video_id, source_track_id)
);

CREATE INDEX IF NOT EXISTS idx_live_event_audio_assets_event
  ON public.live_event_audio_assets(live_event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.live_event_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  audio_asset_id uuid NOT NULL REFERENCES public.live_event_audio_assets(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  transcript_text text,
  executive_summary text,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  docx_storage_bucket text NOT NULL DEFAULT 'live-event-media',
  docx_storage_path text,
  error_code text,
  error_message text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audio_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_live_event_transcripts_event
  ON public.live_event_transcripts(live_event_id, created_at DESC);

ALTER TABLE public.live_event_audio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_event_transcripts ENABLE ROW LEVEL SECURITY;

-- The tables are not a public media API. Only an assigned presenter or a
-- system administrator may inspect their event's metadata. All writes and all
-- Storage access are performed by the dedicated Edge Function with service key.
REVOKE ALL ON TABLE public.live_event_audio_assets FROM anon, authenticated;
REVOKE ALL ON TABLE public.live_event_transcripts FROM anon, authenticated;
GRANT SELECT ON TABLE public.live_event_audio_assets TO authenticated;
GRANT SELECT ON TABLE public.live_event_transcripts TO authenticated;

DROP POLICY IF EXISTS "Live event media readable by presenter or admins" ON public.live_event_audio_assets;
CREATE POLICY "Live event media readable by presenter or admins"
  ON public.live_event_audio_assets
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.is_live_event_presenter(auth.uid(), live_event_id)
  );

DROP POLICY IF EXISTS "Live event transcripts readable by presenter or admins" ON public.live_event_transcripts;
CREATE POLICY "Live event transcripts readable by presenter or admins"
  ON public.live_event_transcripts
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.is_live_event_presenter(auth.uid(), live_event_id)
  );

DROP TRIGGER IF EXISTS trg_live_event_audio_assets_updated_at ON public.live_event_audio_assets;
CREATE TRIGGER trg_live_event_audio_assets_updated_at
  BEFORE UPDATE ON public.live_event_audio_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_live_event_transcripts_updated_at ON public.live_event_transcripts;
CREATE TRIGGER trg_live_event_transcripts_updated_at
  BEFORE UPDATE ON public.live_event_transcripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
