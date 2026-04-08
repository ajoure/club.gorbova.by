
CREATE OR REPLACE FUNCTION public.emit_webinar_domain_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event_type TEXT;
  _payload JSONB;
  _user_id UUID;
  _entity_id UUID;
BEGIN
  _entity_id := NEW.id;

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
      'author_display_name', NULL,
      'reply_preview', LEFT(NEW.reply_text, 200),
      'visibility_scope', NEW.visibility_scope,
      'source_comment_id', NEW.source_comment_id,
      'source_question_id', NEW.source_question_id
    );

  ELSIF TG_TABLE_NAME = 'live_event_room_moderation' THEN
    _user_id := NEW.created_by;
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
