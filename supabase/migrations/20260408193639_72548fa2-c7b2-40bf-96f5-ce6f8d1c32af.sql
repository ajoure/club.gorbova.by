
-- Fix scenario RPC - columns in subquery need explicit aliases
DROP FUNCTION IF EXISTS public.get_live_event_scenario(uuid);
DROP FUNCTION IF EXISTS public.get_live_event_scenario(uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.get_live_event_scenario(
  _live_event_id uuid,
  _entry_type text DEFAULT NULL,
  _filter_user_id uuid DEFAULT NULL,
  _filter_visibility text DEFAULT NULL
)
RETURNS TABLE (
  entry_id uuid,
  entry_type text,
  user_id uuid,
  display_name text,
  entry_text text,
  visibility_scope text,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM (
    SELECT c.id AS entry_id, 'comment'::text AS entry_type, c.user_id, c.author_display_name AS display_name, c.content AS entry_text, NULL::text AS visibility_scope, c.created_at, c.metadata
    FROM live_event_comments c WHERE c.live_event_id = _live_event_id
    UNION ALL
    SELECT q.id, 'question'::text, q.user_id, q.author_display_name, q.content, NULL::text, q.created_at, q.metadata
    FROM live_event_questions q WHERE q.live_event_id = _live_event_id
    UNION ALL
    SELECT r.id, 'reply'::text, r.created_by, NULL::text, r.reply_text, r.visibility_scope, r.created_at, r.metadata
    FROM live_event_replies r WHERE r.live_event_id = _live_event_id
    UNION ALL
    SELECT m.id, 'moderation'::text, m.created_by, NULL::text, m.action_type || ': ' || COALESCE(m.reason,''), NULL::text, m.created_at, m.metadata
    FROM live_event_room_moderation m WHERE m.live_event_id = _live_event_id
  ) t
  WHERE (_entry_type IS NULL OR t.entry_type = _entry_type)
    AND (_filter_user_id IS NULL OR t.user_id = _filter_user_id)
    AND (_filter_visibility IS NULL OR t.visibility_scope = _filter_visibility OR t.visibility_scope IS NULL)
  ORDER BY t.created_at;
$$;

-- RLS for room_blocks (idempotent)
ALTER TABLE public.live_event_room_blocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'live_event_room_blocks' AND policyname = 'Admins can manage room blocks') THEN
    CREATE POLICY "Admins can manage room blocks"
      ON public.live_event_room_blocks FOR ALL TO authenticated
      USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'live_event_room_blocks' AND policyname = 'Users can view active blocks') THEN
    CREATE POLICY "Users can view active blocks"
      ON public.live_event_room_blocks FOR SELECT TO authenticated
      USING (is_active = true);
  END IF;
END $$;

-- RLS for crm_activity_log (idempotent)
ALTER TABLE public.crm_activity_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_activity_log' AND policyname = 'Admins can manage CRM activity') THEN
    CREATE POLICY "Admins can manage CRM activity"
      ON public.crm_activity_log FOR ALL TO authenticated
      USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_replies_source_comment ON public.live_event_replies(source_comment_id) WHERE source_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_replies_source_question ON public.live_event_replies(source_question_id) WHERE source_question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activity_user ON public.crm_activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activity_idemp ON public.crm_activity_log(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_room_blocks_event ON public.live_event_room_blocks(live_event_id, is_active);
