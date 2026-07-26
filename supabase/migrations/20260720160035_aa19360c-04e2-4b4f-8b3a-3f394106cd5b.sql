-- Autoweb runtime: isolate new chat/questions by session, not only event.
CREATE OR REPLACE FUNCTION public.assert_autoweb_session_write(
  _live_event_id uuid, _session_id uuid, _actor_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _session_owner uuid;
BEGIN
  SELECT viewer_user_id INTO _session_owner FROM public.live_event_sessions
   WHERE id = _session_id AND live_event_id = _live_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'metadata.session_id does not belong to this live_event' USING ERRCODE = 'check_violation';
  END IF;
  IF _session_owner IS NOT NULL
     AND _session_owner <> _actor_user_id
     AND NOT has_role_v2(_actor_user_id, 'admin')
     AND NOT has_role_v2(_actor_user_id, 'super_admin')
     AND NOT has_role_v2(_actor_user_id, 'employee') THEN
    RAISE EXCEPTION 'autoweb personal session belongs to another viewer' USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_autoweb_session_id_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_type text; v_session_id text;
BEGIN
  SELECT event_type INTO v_event_type FROM public.live_events WHERE id = NEW.live_event_id;
  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN RETURN NEW; END IF;
  v_session_id := NULLIF(NEW.metadata->>'session_id', '');
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar comments require metadata.session_id' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.assert_autoweb_session_write(NEW.live_event_id, v_session_id::uuid, auth.uid());
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_autoweb_session_id_on_question()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_type text; v_session_id text;
BEGIN
  SELECT event_type INTO v_event_type FROM public.live_events WHERE id = NEW.live_event_id;
  IF v_event_type IS DISTINCT FROM 'autowebinar' THEN RETURN NEW; END IF;
  v_session_id := NULLIF(NEW.metadata->>'session_id', '');
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'autowebinar questions require metadata.session_id' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.assert_autoweb_session_write(NEW.live_event_id, v_session_id::uuid, auth.uid());
  RETURN NEW;
END; $$;

DROP POLICY IF EXISTS "Users with access can read comments" ON public.live_event_comments;
CREATE POLICY "Users read isolated autoweb comments" ON public.live_event_comments
  FOR SELECT TO authenticated
  USING (
    public.user_has_live_event_access(auth.uid(), live_event_id)
    AND (
      NOT EXISTS (SELECT 1 FROM public.live_events e WHERE e.id = live_event_comments.live_event_id AND e.event_type = 'autowebinar')
      OR live_event_comments.user_id = auth.uid()
      OR public.has_role_v2(auth.uid(), 'admin')
      OR public.has_role_v2(auth.uid(), 'super_admin')
      OR public.has_role_v2(auth.uid(), 'employee')
    )
  );

CREATE INDEX IF NOT EXISTS idx_live_event_comments_autoweb_session
  ON public.live_event_comments (live_event_id, ((metadata->>'session_id')), created_at DESC)
  WHERE metadata ? 'session_id';
CREATE INDEX IF NOT EXISTS idx_live_event_questions_autoweb_session
  ON public.live_event_questions (live_event_id, ((metadata->>'session_id')), created_at ASC)
  WHERE metadata ? 'session_id';

-- session participants
CREATE OR REPLACE FUNCTION public.get_autoweb_session_participants(_session_id uuid)
RETURNS TABLE(user_id uuid, display_name text, nickname_color text, show_avatar boolean, avatar_url text, real_name_for_staff text, role_in_room text, last_seen_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _viewer uuid := auth.uid(); _event_id uuid; _session_owner uuid; _is_staff boolean := false;
BEGIN
  IF _viewer IS NULL THEN RETURN; END IF;
  SELECT live_event_id, viewer_user_id INTO _event_id, _session_owner FROM public.live_event_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN; END IF;
  _is_staff := public.is_room_staff(_viewer);
  IF NOT _is_staff AND (NOT public.user_has_live_event_access(_viewer, _event_id) OR (_session_owner IS NOT NULL AND _session_owner <> _viewer)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.viewer_user_id, COALESCE(pref.display_name, 'Гость'), pref.nickname_color, COALESCE(pref.show_avatar, false),
    CASE WHEN _is_staff OR COALESCE(pref.show_avatar, false) THEN profile.avatar_url ELSE NULL END,
    CASE WHEN _is_staff THEN COALESCE(NULLIF(TRIM(profile.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', profile.first_name, profile.last_name)), ''), profile.email) ELSE NULL END,
    CASE WHEN public.has_role_v2(p.viewer_user_id, 'super_admin') OR public.has_role_v2(p.viewer_user_id, 'admin') THEN 'admin'
         WHEN public.has_role_v2(p.viewer_user_id, 'employee') THEN 'staff' ELSE 'user' END,
    p.last_seen_at
  FROM public.live_event_session_progress p
  LEFT JOIN public.live_event_participant_prefs pref ON pref.live_event_id = _event_id AND pref.user_id = p.viewer_user_id
  LEFT JOIN public.profiles profile ON profile.user_id = p.viewer_user_id
  WHERE p.session_id = _session_id AND p.viewer_user_id IS NOT NULL AND p.last_seen_at > now() - interval '2 minutes'
  ORDER BY p.last_seen_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.get_autoweb_session_participants(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_autoweb_session_participants(uuid) TO authenticated;

-- scenario runtime read
CREATE OR REPLACE FUNCTION public.autoweb_scenario_runtime_list(_session_id uuid, _live_event_id uuid)
RETURNS TABLE(id uuid, entry_type text, offset_seconds integer, actor_display_name text, content_text text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _viewer uuid := auth.uid(); _session_event_id uuid; _session_owner uuid; _is_staff boolean := false;
BEGIN
  IF _viewer IS NULL THEN RETURN; END IF;
  SELECT live_event_id, viewer_user_id INTO _session_event_id, _session_owner FROM public.live_event_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN; END IF;
  _is_staff := public.is_room_staff(_viewer);
  IF NOT _is_staff AND (NOT public.user_has_live_event_access(_viewer, _session_event_id) OR (_session_owner IS NOT NULL AND _session_owner <> _viewer)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT e.id, e.entry_type, e.offset_seconds, e.actor_display_name, e.content_text
  FROM public.autoweb_scenario_entries e
  WHERE e.live_event_id = _live_event_id AND e.state = 'applied' AND e.visibility_scope = 'public'
  ORDER BY e.offset_seconds ASC, e.created_at ASC;
END; $$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_runtime_list(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_runtime_list(uuid, uuid) TO authenticated;

-- timed CTA
ALTER TABLE public.autoweb_scenario_entries DROP CONSTRAINT IF EXISTS autoweb_scenario_entries_entry_type_check;
ALTER TABLE public.autoweb_scenario_entries ADD CONSTRAINT autoweb_scenario_entries_entry_type_check
  CHECK (entry_type IN ('chat','question','host_message','reaction','cta'));

CREATE OR REPLACE FUNCTION public.autoweb_scenario_runtime_list_v2(_session_id uuid, _live_event_id uuid)
RETURNS TABLE(id uuid, entry_type text, offset_seconds integer, actor_display_name text, content_text text, metadata jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT e.id, e.entry_type, e.offset_seconds, e.actor_display_name, e.content_text, e.metadata
  FROM public.autoweb_scenario_entries e
  JOIN public.live_event_sessions s ON s.id = _session_id
  WHERE auth.uid() IS NOT NULL
    AND (public.is_room_staff(auth.uid()) OR (public.user_has_live_event_access(auth.uid(), s.live_event_id) AND (s.viewer_user_id IS NULL OR s.viewer_user_id = auth.uid())))
    AND _live_event_id = s.live_event_id
    AND e.live_event_id = _live_event_id AND e.state = 'applied' AND e.visibility_scope = 'public'
  ORDER BY e.offset_seconds ASC, e.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_runtime_list_v2(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_runtime_list_v2(uuid, uuid) TO authenticated;

-- stale session self-heal
CREATE OR REPLACE FUNCTION public.close_stale_autoweb_sessions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _closed integer := 0;
BEGIN
  WITH candidates AS (
    SELECT id, live_event_id, metadata FROM public.live_event_sessions
     WHERE status IN ('pending', 'live')
       AND ends_at < now() - interval '5 minutes'
       AND metadata->>'auto_ended_at' IS NULL
       AND (
         metadata->>'last_heartbeat_at' IS NULL
         OR metadata->>'last_heartbeat_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$'
         OR (metadata->>'last_heartbeat_at')::timestamptz < now() - interval '15 minutes'
       )
     FOR UPDATE SKIP LOCKED
  ), healed AS (
    UPDATE public.live_event_sessions s
       SET status = 'ended',
           metadata = s.metadata || jsonb_build_object('auto_ended_at', now()::text, 'auto_end_reason', 'server_self_heal'),
           updated_at = now()
      FROM candidates c
     WHERE s.id = c.id AND s.status IN ('pending', 'live') AND s.metadata->>'auto_ended_at' IS NULL
    RETURNING s.id, s.live_event_id
  ), logged AS (
    INSERT INTO public.audit_logs(action, entity_type, entity_id, actor_type, meta)
    SELECT 'autoweb.session.self_healed', 'live_event_session', id, 'system', jsonb_build_object('reason', 'server_self_heal')
    FROM healed RETURNING id
  )
  SELECT count(*) INTO _closed FROM healed;
  RETURN _closed;
END; $$;
REVOKE ALL ON FUNCTION public.close_stale_autoweb_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_stale_autoweb_sessions() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autoweb-stale-session-self-heal') THEN
    PERFORM cron.unschedule('autoweb-stale-session-self-heal');
  END IF;
END $$;
SELECT cron.schedule('autoweb-stale-session-self-heal', '*/5 * * * *', 'SELECT public.close_stale_autoweb_sessions();');

-- real viewer count
CREATE OR REPLACE FUNCTION public.autoweb_session_real_viewer_count(_session_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::integer FROM public.live_event_session_progress p
  WHERE p.session_id = _session_id AND p.viewer_user_id IS NOT NULL
    AND p.last_seen_at > now() - interval '2 minutes'
    AND NOT public.is_room_staff(p.viewer_user_id);
$$;
REVOKE ALL ON FUNCTION public.autoweb_session_real_viewer_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_session_real_viewer_count(uuid) TO service_role;

-- scenario bulk shift with scopes
DROP FUNCTION IF EXISTS public.autoweb_scenario_bulk_shift(uuid, integer);

CREATE OR REPLACE FUNCTION public.autoweb_scenario_bulk_shift_preview(_live_event_id uuid, _delta_seconds integer, _scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_count integer := 0; v_sample jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  IF _scope NOT IN ('comments', 'buttons', 'all') THEN RAISE EXCEPTION 'invalid bulk shift scope'; END IF;
  SELECT count(*) INTO v_count FROM public.autoweb_scenario_entries
   WHERE live_event_id = _live_event_id AND state = 'draft'
     AND (_scope = 'all' OR (_scope = 'buttons' AND entry_type = 'cta') OR (_scope = 'comments' AND entry_type <> 'cta'));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'entry_type', entry_type,
    'from_offset_seconds', offset_seconds,
    'to_offset_seconds', GREATEST(0, LEAST(86400, offset_seconds + _delta_seconds))
  ) ORDER BY offset_seconds, created_at), '[]'::jsonb) INTO v_sample
  FROM (SELECT id, entry_type, offset_seconds, created_at FROM public.autoweb_scenario_entries
        WHERE live_event_id = _live_event_id AND state = 'draft'
          AND (_scope = 'all' OR (_scope = 'buttons' AND entry_type = 'cta') OR (_scope = 'comments' AND entry_type <> 'cta'))
        ORDER BY offset_seconds, created_at LIMIT 20) AS pr;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'bulk_shift_preview', jsonb_build_object('scope', _scope, 'delta_seconds', _delta_seconds, 'affected', v_count));
  RETURN jsonb_build_object('status', 'ok', 'scope', _scope, 'delta_seconds', _delta_seconds, 'affected', v_count, 'sample', v_sample);
END; $$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_bulk_shift_preview(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_bulk_shift_preview(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.autoweb_scenario_bulk_shift(_live_event_id uuid, _delta_seconds integer, _scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_count integer := 0;
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  IF _scope NOT IN ('comments', 'buttons', 'all') THEN RAISE EXCEPTION 'invalid bulk shift scope'; END IF;
  UPDATE public.autoweb_scenario_entries
     SET offset_seconds = GREATEST(0, LEAST(86400, offset_seconds + _delta_seconds))
   WHERE live_event_id = _live_event_id AND state = 'draft'
     AND (_scope = 'all' OR (_scope = 'buttons' AND entry_type = 'cta') OR (_scope = 'comments' AND entry_type <> 'cta'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'bulk_shift_apply', jsonb_build_object('scope', _scope, 'delta_seconds', _delta_seconds, 'affected', v_count));
  RETURN jsonb_build_object('status', 'ok', 'scope', _scope, 'affected', v_count, 'delta_seconds', _delta_seconds);
END; $$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, integer, text) TO authenticated;

-- editor audit trigger
CREATE OR REPLACE FUNCTION public.audit_autoweb_editor_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_actor_type text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;
BEGIN
  IF OLD.replay_enabled IS DISTINCT FROM NEW.replay_enabled THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.replay_access_toggled', 'live_event', NEW.id::text, jsonb_build_object('from', OLD.replay_enabled, 'to', NEW.replay_enabled));
  END IF;
  IF OLD.launches_end_at IS DISTINCT FROM NEW.launches_end_at THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.launches_end_at_updated', 'live_event', NEW.id::text, jsonb_build_object('from', OLD.launches_end_at, 'to', NEW.launches_end_at));
  END IF;
  IF COALESCE(OLD.autoweb_config->'viewer_counts', 'null'::jsonb) IS DISTINCT FROM COALESCE(NEW.autoweb_config->'viewer_counts', 'null'::jsonb) THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.viewer_settings_updated', 'live_event', NEW.id::text, jsonb_build_object('from', OLD.autoweb_config->'viewer_counts', 'to', NEW.autoweb_config->'viewer_counts'));
  END IF;
  IF COALESCE(OLD.autoweb_config->'chat', 'null'::jsonb) IS DISTINCT FROM COALESCE(NEW.autoweb_config->'chat', 'null'::jsonb) THEN
    INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
    VALUES (v_actor, v_actor_type, 'autoweb.chat_settings_updated', 'live_event', NEW.id::text, jsonb_build_object('from', OLD.autoweb_config->'chat', 'to', NEW.autoweb_config->'chat'));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_live_events_autoweb_editor_audit ON public.live_events;
CREATE TRIGGER trg_live_events_autoweb_editor_audit
AFTER UPDATE OF replay_enabled, launches_end_at, autoweb_config ON public.live_events
FOR EACH ROW EXECUTE FUNCTION public.audit_autoweb_editor_settings();

-- test mode audit
CREATE OR REPLACE FUNCTION public.autoweb_scenario_test_mode_audit(_live_event_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, CASE WHEN _active THEN 'test_mode_started' ELSE 'test_mode_stopped' END, jsonb_build_object('isolated', true));
  RETURN jsonb_build_object('status', 'ok', 'active', _active);
END; $$;
REVOKE ALL ON FUNCTION public.autoweb_scenario_test_mode_audit(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_test_mode_audit(uuid, boolean) TO authenticated;