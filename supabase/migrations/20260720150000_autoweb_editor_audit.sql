-- Audit editor changes at the existing live_events source of truth. This is a
-- narrow after-update trigger: it observes settings, never changes lifecycle.

CREATE OR REPLACE FUNCTION public.audit_autoweb_editor_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_type text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;
BEGIN
  IF OLD.replay_enabled IS DISTINCT FROM NEW.replay_enabled THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.replay_access_toggled', 'live_event', NEW.id::text,
      jsonb_build_object('from', OLD.replay_enabled, 'to', NEW.replay_enabled));
  END IF;

  IF OLD.launches_end_at IS DISTINCT FROM NEW.launches_end_at THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.launches_end_at_updated', 'live_event', NEW.id::text,
      jsonb_build_object('from', OLD.launches_end_at, 'to', NEW.launches_end_at));
  END IF;

  IF COALESCE(OLD.autoweb_config->'viewer_counts', 'null'::jsonb)
     IS DISTINCT FROM COALESCE(NEW.autoweb_config->'viewer_counts', 'null'::jsonb) THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.viewer_settings_updated', 'live_event', NEW.id::text,
      jsonb_build_object('from', OLD.autoweb_config->'viewer_counts', 'to', NEW.autoweb_config->'viewer_counts'));
  END IF;

  IF COALESCE(OLD.autoweb_config->'chat', 'null'::jsonb)
     IS DISTINCT FROM COALESCE(NEW.autoweb_config->'chat', 'null'::jsonb) THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.chat_settings_updated', 'live_event', NEW.id::text,
      jsonb_build_object('from', OLD.autoweb_config->'chat', 'to', NEW.autoweb_config->'chat'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_events_autoweb_editor_audit ON public.live_events;
CREATE TRIGGER trg_live_events_autoweb_editor_audit
AFTER UPDATE OF replay_enabled, launches_end_at, autoweb_config ON public.live_events
FOR EACH ROW EXECUTE FUNCTION public.audit_autoweb_editor_settings();
