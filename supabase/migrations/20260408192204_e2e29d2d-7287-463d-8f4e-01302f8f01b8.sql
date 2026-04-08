
-- =============================================
-- Migration: Webinar Room Stabilization
-- =============================================

-- 1. Extend live_event_comments
ALTER TABLE public.live_event_comments
  ADD COLUMN IF NOT EXISTS author_display_name text,
  ADD COLUMN IF NOT EXISTS author_avatar_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- 2. Extend live_event_questions
ALTER TABLE public.live_event_questions
  ADD COLUMN IF NOT EXISTS author_display_name text,
  ADD COLUMN IF NOT EXISTS author_avatar_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- 3. Create live_event_replies
CREATE TABLE public.live_event_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('rep_' || gen_random_uuid()::text),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  source_comment_id uuid REFERENCES public.live_event_comments(id) ON DELETE CASCADE,
  source_question_id uuid REFERENCES public.live_event_questions(id) ON DELETE CASCADE,
  target_user_id uuid,
  target_display_name text,
  reply_text text NOT NULL,
  visibility_scope text NOT NULL CHECK (visibility_scope IN ('public','private')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  metadata jsonb DEFAULT '{}',
  CONSTRAINT exactly_one_source CHECK (num_nonnulls(source_comment_id, source_question_id) = 1)
);

CREATE INDEX idx_replies_event_created ON public.live_event_replies(live_event_id, created_at DESC);
CREATE INDEX idx_replies_target ON public.live_event_replies(target_user_id, live_event_id);
CREATE INDEX idx_replies_source_comment ON public.live_event_replies(source_comment_id);
CREATE INDEX idx_replies_source_question ON public.live_event_replies(source_question_id);

ALTER TABLE public.live_event_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage replies"
  ON public.live_event_replies FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Users can read visible replies"
  ON public.live_event_replies FOR SELECT TO authenticated
  USING (
    visibility_scope = 'public'
    OR target_user_id = auth.uid()
  );

-- 4. Create live_event_room_moderation
CREATE TABLE public.live_event_room_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('mod_' || gen_random_uuid()::text),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('removed','banned','restored')),
  reason text,
  expires_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX idx_moderation_event_user ON public.live_event_room_moderation(live_event_id, user_id, created_at DESC);

ALTER TABLE public.live_event_room_moderation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage moderation"
  ON public.live_event_room_moderation FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- 5. RPC: is_user_removed_from_room
CREATE OR REPLACE FUNCTION public.is_user_removed_from_room(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT action_type IN ('removed','banned')
     FROM public.live_event_room_moderation
     WHERE user_id = _user_id AND live_event_id = _live_event_id
     ORDER BY created_at DESC LIMIT 1),
    false
  )
$$;

-- 6. Update user_has_live_event_access with moderation overlay
CREATE OR REPLACE FUNCTION public.user_has_live_event_access(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT (
    (
      EXISTS (
        SELECT 1 FROM public.user_roles_v2 ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = _user_id
          AND r.code IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.live_event_access_rules lear
        WHERE lear.live_event_id = _live_event_id
          AND (
            EXISTS (
              SELECT 1 FROM public.subscriptions_v2 s
              WHERE s.user_id = _user_id
                AND s.product_id = lear.product_id
                AND s.status::text IN ('active', 'past_due')
                AND (s.access_end_at IS NULL OR s.access_end_at > now())
                AND (lear.tariff_id IS NULL OR s.tariff_id = lear.tariff_id)
            )
            OR
            EXISTS (
              SELECT 1 FROM public.entitlements e
              WHERE e.user_id = _user_id
                AND e.product_id = lear.product_id
                AND e.status = 'active'
                AND (e.expires_at IS NULL OR e.expires_at > now())
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.live_access_proofs lap
        WHERE lap.live_event_id = _live_event_id
          AND lap.user_id = _user_id
          AND (lap.expires_at IS NULL OR lap.expires_at > now())
      )
    )
    AND NOT public.is_user_removed_from_room(_user_id, _live_event_id)
  )
$$;

-- 7. Update comments INSERT policy with moderation check
DROP POLICY IF EXISTS "Users with access can insert own comments" ON public.live_event_comments;
CREATE POLICY "Users with access can insert own comments"
  ON public.live_event_comments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_live_event_access(auth.uid(), live_event_id)
  );

-- 8. Update questions INSERT policy with moderation check
DROP POLICY IF EXISTS "Users with access can insert own questions" ON public.live_event_questions;
CREATE POLICY "Users with access can insert own questions"
  ON public.live_event_questions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_live_event_access(auth.uid(), live_event_id)
  );

-- 9. Create live_event_room_blocks
CREATE TABLE public.live_event_room_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('blk_' || gen_random_uuid()::text),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  block_type text NOT NULL CHECK (block_type IN ('button','banner','form')),
  display_scope text NOT NULL CHECK (display_scope IN ('always','live_only','replay_only')),
  position text NOT NULL CHECK (position IN ('under_video','sidebar','sticky')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX idx_room_blocks_event ON public.live_event_room_blocks(live_event_id, sort_order);

ALTER TABLE public.live_event_room_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage room blocks"
  ON public.live_event_room_blocks FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can read active blocks"
  ON public.live_event_room_blocks FOR SELECT TO authenticated
  USING (is_active = true);

-- 10. Create crm_activity_log
CREATE TABLE public.crm_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('act_' || gen_random_uuid()::text),
  contact_id uuid,
  user_id uuid NOT NULL,
  activity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  source_entity_type text NOT NULL,
  live_event_id uuid REFERENCES public.live_events(id),
  title_snapshot text,
  text_snapshot text,
  author_snapshot text,
  visibility_scope text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX idx_crm_activity_user ON public.crm_activity_log(user_id, created_at DESC);
CREATE INDEX idx_crm_activity_event ON public.crm_activity_log(live_event_id);

ALTER TABLE public.crm_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage CRM activity"
  ON public.crm_activity_log FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- 11. Author display name snapshot trigger
CREATE OR REPLACE FUNCTION public.snapshot_author_display_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _profile RECORD;
BEGIN
  IF NEW.author_display_name IS NULL THEN
    SELECT full_name, first_name, last_name, avatar_url, email
    INTO _profile
    FROM public.profiles
    WHERE id = NEW.user_id;

    NEW.author_display_name := COALESCE(
      NULLIF(TRIM(_profile.full_name), ''),
      NULLIF(TRIM(CONCAT_WS(' ', _profile.first_name, _profile.last_name)), ''),
      CASE WHEN _profile.email IS NOT NULL AND _profile.email != ''
        THEN CONCAT(LEFT(_profile.email, 3), '***')
        ELSE NULL
      END,
      'Пользователь'
    );

    IF NEW.author_avatar_url IS NULL AND _profile.avatar_url IS NOT NULL THEN
      NEW.author_avatar_url := _profile.avatar_url;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_comment_author
  BEFORE INSERT ON public.live_event_comments
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_author_display_name();

CREATE TRIGGER trg_snapshot_question_author
  BEFORE INSERT ON public.live_event_questions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_author_display_name();

-- 12. Scenario RPC with explicit column names
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT sub.entry_id, sub.entry_type, sub.user_id, sub.display_name,
         sub.entry_text, sub.visibility_scope, sub.created_at, sub.metadata
  FROM (
    SELECT c.id AS entry_id, 'comment'::text AS entry_type, c.user_id, c.author_display_name AS display_name,
           c.content AS entry_text, NULL::text AS visibility_scope, c.created_at, c.metadata
    FROM public.live_event_comments c WHERE c.live_event_id = _live_event_id
    UNION ALL
    SELECT q.id, 'question'::text, q.user_id, q.author_display_name,
           q.content, NULL::text, q.created_at, q.metadata
    FROM public.live_event_questions q WHERE q.live_event_id = _live_event_id
    UNION ALL
    SELECT r.id, 'reply'::text, r.created_by, NULL::text,
           r.reply_text, r.visibility_scope, r.created_at, r.metadata
    FROM public.live_event_replies r WHERE r.live_event_id = _live_event_id
    UNION ALL
    SELECT m.id, 'moderation'::text, m.created_by, NULL::text,
           m.action_type || ': ' || COALESCE(m.reason,''), NULL::text, m.created_at, m.metadata
    FROM public.live_event_room_moderation m WHERE m.live_event_id = _live_event_id
  ) sub
  WHERE (_entry_type IS NULL OR sub.entry_type = _entry_type)
    AND (_filter_user_id IS NULL OR sub.user_id = _filter_user_id)
    AND (_filter_visibility IS NULL OR sub.visibility_scope = _filter_visibility OR sub.visibility_scope IS NULL)
  ORDER BY sub.created_at;
END;
$$;
