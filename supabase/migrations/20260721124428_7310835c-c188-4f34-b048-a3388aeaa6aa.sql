-- === Telegram-style reactions for chat comments ===
CREATE TABLE IF NOT EXISTS public.live_event_comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.live_event_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji = ANY (ARRAY[
    '👍','👎','❤️','🔥','🥰','👏','😁','🤔','🤯','😱','🤬','😢','🎉','🤩','🤮','💩','🙏','👌','🕊','🤡',
    '🥱','🥴','😍','🐳','❤️‍🔥','🌚','🌭','💯','🤣','⚡','🍌','🏆','💔','🤨','😐','🍓','🍾','💋','🖕','😈',
    '😴','😭','🤓','👻','👨‍💻','👀','🎃','🙈','😇','😨','🤝','✍️','🤗','🫡','🎅','🎄','☃️','💅','🤪','🗿',
    '🆒','💘','🙉','🦄','😘','💊','🙊','😎','👾','🤷‍♂️','🤷','🤷‍♀️','😡'
  ])),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_live_comment_reactions_comment_created
  ON public.live_event_comment_reactions (comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_comment_reactions_user_recent
  ON public.live_event_comment_reactions (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.live_event_comment_reactions TO authenticated;
GRANT ALL ON public.live_event_comment_reactions TO service_role;

ALTER TABLE public.live_event_comment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_event_comment_reactions REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.can_send_live_comment_reaction(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_room_staff(_user_id)
    OR (
      SELECT count(*) < 10
      FROM public.live_event_comment_reactions r
      WHERE r.user_id = _user_id AND r.created_at > now() - interval '5 seconds'
    );
$$;
REVOKE ALL ON FUNCTION public.can_send_live_comment_reaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_live_comment_reaction(uuid) TO authenticated;

CREATE POLICY "Users read visible live comment reactions"
  ON public.live_event_comment_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.live_event_comments c
      WHERE c.id = comment_id
        AND public.user_has_live_event_access(auth.uid(), c.live_event_id)
        AND (
          NOT EXISTS (SELECT 1 FROM public.live_events e WHERE e.id = c.live_event_id AND e.event_type = 'autowebinar')
          OR c.user_id = auth.uid()
          OR public.is_room_staff(auth.uid())
        )
    )
  );

CREATE POLICY "Users add own live comment reactions"
  ON public.live_event_comment_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_send_live_comment_reaction(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.live_event_comments c
      WHERE c.id = comment_id
        AND public.user_has_live_event_access(auth.uid(), c.live_event_id)
        AND NOT public.is_user_removed_from_room(auth.uid(), c.live_event_id)
        AND NOT public.is_user_muted_in_room(auth.uid(), c.live_event_id)
        AND (
          NOT EXISTS (SELECT 1 FROM public.live_events e WHERE e.id = c.live_event_id AND e.event_type = 'autowebinar')
          OR c.user_id = auth.uid()
          OR public.is_room_staff(auth.uid())
        )
    )
  );

CREATE POLICY "Users remove own live comment reactions"
  ON public.live_event_comment_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.live_event_comment_reaction_summary(_comment_ids uuid[])
RETURNS TABLE (comment_id uuid, emoji text, reaction_count integer, user_reacted boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT r.comment_id, r.emoji, count(*)::integer AS reaction_count,
         bool_or(r.user_id = auth.uid()) AS user_reacted
  FROM public.live_event_comment_reactions r
  WHERE r.comment_id = ANY(_comment_ids)
  GROUP BY r.comment_id, r.emoji
  ORDER BY r.comment_id, reaction_count DESC, r.emoji ASC;
$$;
REVOKE ALL ON FUNCTION public.live_event_comment_reaction_summary(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_event_comment_reaction_summary(uuid[]) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='live_event_comment_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_comment_reactions;
  END IF;
END $$;

-- === Live-event media: audio + transcripts ===
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
    CHECK (status IN ('pending','copying','ready','no_audio','failed')),
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
    CHECK (status IN ('pending','processing','ready','failed')),
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

REVOKE ALL ON TABLE public.live_event_audio_assets FROM anon, authenticated;
REVOKE ALL ON TABLE public.live_event_transcripts FROM anon, authenticated;
GRANT SELECT ON TABLE public.live_event_audio_assets TO authenticated;
GRANT SELECT ON TABLE public.live_event_transcripts TO authenticated;
GRANT ALL ON TABLE public.live_event_audio_assets TO service_role;
GRANT ALL ON TABLE public.live_event_transcripts TO service_role;

ALTER TABLE public.live_event_audio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_event_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Live event media readable by presenter or admins" ON public.live_event_audio_assets;
CREATE POLICY "Live event media readable by presenter or admins"
  ON public.live_event_audio_assets FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.is_live_event_presenter(auth.uid(), live_event_id)
  );

DROP POLICY IF EXISTS "Live event transcripts readable by presenter or admins" ON public.live_event_transcripts;
CREATE POLICY "Live event transcripts readable by presenter or admins"
  ON public.live_event_transcripts FOR SELECT TO authenticated
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

-- === storage.objects RLS for the private live-event-media bucket ===
DROP POLICY IF EXISTS "Live event media objects readable by presenter or admins" ON storage.objects;
CREATE POLICY "Live event media objects readable by presenter or admins"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'live-event-media'
    AND (
      public.has_role_v2(auth.uid(), 'admin')
      OR public.has_role_v2(auth.uid(), 'super_admin')
    )
  );