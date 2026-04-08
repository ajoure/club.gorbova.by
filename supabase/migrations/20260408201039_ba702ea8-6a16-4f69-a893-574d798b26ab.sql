
-- ============================================================
-- PATCH A: Fix snapshot_author_display_name trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.snapshot_author_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _profile RECORD;
BEGIN
  IF NEW.author_display_name IS NULL THEN
    SELECT full_name, first_name, last_name, avatar_url, email
    INTO _profile
    FROM public.profiles
    WHERE user_id = NEW.user_id;

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

-- PATCH A: One-shot repair for existing comments
UPDATE public.live_event_comments c
SET author_display_name = COALESCE(
  NULLIF(TRIM(p.full_name), ''),
  NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
  CASE WHEN p.email IS NOT NULL AND p.email != ''
    THEN CONCAT(LEFT(p.email, 3), '***')
    ELSE NULL
  END,
  'Пользователь'
),
author_avatar_url = COALESCE(c.author_avatar_url, p.avatar_url)
FROM public.profiles p
WHERE p.user_id = c.user_id
  AND c.author_display_name IS NULL;

-- PATCH A: One-shot repair for existing questions
UPDATE public.live_event_questions q
SET author_display_name = COALESCE(
  NULLIF(TRIM(p.full_name), ''),
  NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
  CASE WHEN p.email IS NOT NULL AND p.email != ''
    THEN CONCAT(LEFT(p.email, 3), '***')
    ELSE NULL
  END,
  'Пользователь'
),
author_avatar_url = COALESCE(q.author_avatar_url, p.avatar_url)
FROM public.profiles p
WHERE p.user_id = q.user_id
  AND q.author_display_name IS NULL;

-- ============================================================
-- PATCH B: Domain event triggers for CRM pipeline
-- ============================================================

CREATE OR REPLACE FUNCTION public.emit_webinar_domain_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _event_type TEXT;
  _payload JSONB;
  _user_id UUID;
  _entity_id UUID;
BEGIN
  _entity_id := NEW.id;

  -- Determine event_type and build payload based on source table
  IF TG_TABLE_NAME = 'live_event_comments' THEN
    _event_type := 'live_comment_created';
    _user_id := NEW.user_id;
    _payload := jsonb_build_object(
      'live_event_id', NEW.live_event_id,
      'user_id', NEW.user_id,
      'author_display_name', NEW.author_display_name,
      'content_preview', LEFT(NEW.content, 200),
      'visibility_scope', 'public'
    );

  ELSIF TG_TABLE_NAME = 'live_event_questions' THEN
    _event_type := 'live_question_created';
    _user_id := NEW.user_id;
    _payload := jsonb_build_object(
      'live_event_id', NEW.live_event_id,
      'user_id', NEW.user_id,
      'author_display_name', NEW.author_display_name,
      'content_preview', LEFT(NEW.content, 200),
      'visibility_scope', 'public'
    );

  ELSIF TG_TABLE_NAME = 'live_event_replies' THEN
    _event_type := 'live_reply_created';
    _user_id := NEW.created_by;
    _payload := jsonb_build_object(
      'live_event_id', NEW.live_event_id,
      'created_by', NEW.created_by,
      'author_display_name', NEW.author_display_name,
      'reply_preview', LEFT(NEW.reply_text, 200),
      'visibility_scope', NEW.visibility_scope,
      'comment_id', NEW.comment_id,
      'question_id', NEW.question_id
    );

  ELSIF TG_TABLE_NAME = 'live_event_room_moderation' THEN
    _user_id := NEW.created_by;
    -- Map action_type to event_type
    IF NEW.action_type = 'removed' THEN
      _event_type := 'live_user_removed_from_room';
    ELSIF NEW.action_type = 'banned' THEN
      _event_type := 'live_user_banned_from_room';
    ELSIF NEW.action_type = 'restored' THEN
      _event_type := 'live_user_restored_to_room';
    ELSE
      _event_type := 'live_moderation_' || NEW.action_type;
    END IF;

    _payload := jsonb_build_object(
      'live_event_id', NEW.live_event_id,
      'created_by', NEW.created_by,
      'user_id', NEW.user_id,
      'action_type', NEW.action_type,
      'reason', NEW.reason
    );

  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.domain_events (event_type, source, entity_id, payload)
  VALUES (_event_type, 'webinar', _entity_id, _payload);

  RETURN NEW;
END;
$$;

-- Attach triggers
CREATE TRIGGER trg_emit_domain_event_comment
  AFTER INSERT ON public.live_event_comments
  FOR EACH ROW EXECUTE FUNCTION public.emit_webinar_domain_event();

CREATE TRIGGER trg_emit_domain_event_question
  AFTER INSERT ON public.live_event_questions
  FOR EACH ROW EXECUTE FUNCTION public.emit_webinar_domain_event();

CREATE TRIGGER trg_emit_domain_event_reply
  AFTER INSERT ON public.live_event_replies
  FOR EACH ROW EXECUTE FUNCTION public.emit_webinar_domain_event();

CREATE TRIGGER trg_emit_domain_event_moderation
  AFTER INSERT ON public.live_event_room_moderation
  FOR EACH ROW EXECUTE FUNCTION public.emit_webinar_domain_event();

-- ============================================================
-- PATCH C (Hardening): Explicit moderation check in INSERT policies
-- ============================================================

DROP POLICY IF EXISTS "Users with access can insert own comments" ON public.live_event_comments;
CREATE POLICY "Users with access can insert own comments"
  ON public.live_event_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
  );

DROP POLICY IF EXISTS "Users with access can insert own questions" ON public.live_event_questions;
CREATE POLICY "Users with access can insert own questions"
  ON public.live_event_questions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
  );
