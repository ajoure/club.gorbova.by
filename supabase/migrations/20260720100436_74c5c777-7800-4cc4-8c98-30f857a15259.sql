
-- =============================================================
-- D-slice-3: Autoweb Scenario Editor (admin-only CRUD)
-- Fully isolated from live_event_comments / live_event_questions.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.autoweb_scenario_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('chat','question','host_message','reaction')),
  offset_seconds integer NOT NULL CHECK (offset_seconds >= 0 AND offset_seconds <= 86400),
  actor_display_name text,
  actor_avatar_url text,
  content_text text NOT NULL CHECK (char_length(content_text) BETWEEN 1 AND 2000),
  visibility_scope text NOT NULL DEFAULT 'public' CHECK (visibility_scope IN ('public','private')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','applied','archived')),
  applied_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autoweb_scenario_entries_event
  ON public.autoweb_scenario_entries(live_event_id, state, offset_seconds);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autoweb_scenario_entries TO authenticated;
GRANT ALL ON public.autoweb_scenario_entries TO service_role;
ALTER TABLE public.autoweb_scenario_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autoweb_scenario_entries_admin_all"
  ON public.autoweb_scenario_entries FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.autoweb_scenario_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_autoweb_scenario_entries_touch ON public.autoweb_scenario_entries;
CREATE TRIGGER trg_autoweb_scenario_entries_touch
  BEFORE UPDATE ON public.autoweb_scenario_entries
  FOR EACH ROW EXECUTE FUNCTION public.autoweb_scenario_touch_updated_at();

-- Audit trail
CREATE TABLE IF NOT EXISTS public.autoweb_scenario_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autoweb_scenario_audit_event
  ON public.autoweb_scenario_audit(live_event_id, created_at DESC);

GRANT SELECT ON public.autoweb_scenario_audit TO authenticated;
GRANT ALL ON public.autoweb_scenario_audit TO service_role;
ALTER TABLE public.autoweb_scenario_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autoweb_scenario_audit_admin_select"
  ON public.autoweb_scenario_audit FOR SELECT
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- =============================================================
-- Helper: admin guard
-- =============================================================
CREATE OR REPLACE FUNCTION public._autoweb_scenario_require_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public._autoweb_scenario_require_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._autoweb_scenario_require_admin() TO authenticated;

-- =============================================================
-- RPCs
-- =============================================================

-- list
CREATE OR REPLACE FUNCTION public.autoweb_scenario_list(
  _live_event_id uuid,
  _include_applied boolean DEFAULT true
) RETURNS SETOF public.autoweb_scenario_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  RETURN QUERY
  SELECT * FROM public.autoweb_scenario_entries
  WHERE live_event_id = _live_event_id
    AND state <> 'archived'
    AND (_include_applied OR state = 'draft')
  ORDER BY offset_seconds ASC, created_at ASC;
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_list(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_list(uuid, boolean) TO authenticated;

-- upsert (create/update as draft)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_upsert(
  _live_event_id uuid,
  _entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item jsonb;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_created int := 0;
  v_updated int := 0;
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  IF _entries IS NULL OR jsonb_typeof(_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be jsonb array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_entries)
  LOOP
    v_id := NULLIF(v_item->>'id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.autoweb_scenario_entries(
        live_event_id, entry_type, offset_seconds,
        actor_display_name, actor_avatar_url,
        content_text, visibility_scope, metadata, state, created_by
      ) VALUES (
        _live_event_id,
        v_item->>'entry_type',
        COALESCE((v_item->>'offset_seconds')::int, 0),
        v_item->>'actor_display_name',
        v_item->>'actor_avatar_url',
        v_item->>'content_text',
        COALESCE(v_item->>'visibility_scope','public'),
        COALESCE(v_item->'metadata','{}'::jsonb),
        'draft',
        v_actor
      ) RETURNING id INTO v_id;
      v_created := v_created + 1;
    ELSE
      UPDATE public.autoweb_scenario_entries SET
        entry_type = COALESCE(v_item->>'entry_type', entry_type),
        offset_seconds = COALESCE((v_item->>'offset_seconds')::int, offset_seconds),
        actor_display_name = COALESCE(v_item->>'actor_display_name', actor_display_name),
        actor_avatar_url = COALESCE(v_item->>'actor_avatar_url', actor_avatar_url),
        content_text = COALESCE(v_item->>'content_text', content_text),
        visibility_scope = COALESCE(v_item->>'visibility_scope', visibility_scope),
        metadata = COALESCE(v_item->'metadata', metadata),
        state = 'draft'
      WHERE id = v_id AND live_event_id = _live_event_id;
      v_updated := v_updated + 1;
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'upsert', jsonb_build_object('created', v_created, 'updated', v_updated, 'ids', v_ids));

  RETURN jsonb_build_object('status','ok','created',v_created,'updated',v_updated,'ids',v_ids);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_upsert(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_upsert(uuid, jsonb) TO authenticated;

-- delete (archive drafts or applied)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_delete(
  _live_event_id uuid,
  _entry_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  UPDATE public.autoweb_scenario_entries
     SET state = 'archived'
   WHERE live_event_id = _live_event_id AND id = ANY(_entry_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'delete', jsonb_build_object('archived', v_count, 'ids', _entry_ids));
  RETURN jsonb_build_object('status','ok','archived',v_count);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_delete(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_delete(uuid, uuid[]) TO authenticated;

-- bulk_shift (shift drafts by N seconds; negative allowed but clamped to 0)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_bulk_shift(
  _live_event_id uuid,
  _delta_seconds int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  UPDATE public.autoweb_scenario_entries
     SET offset_seconds = GREATEST(0, LEAST(86400, offset_seconds + _delta_seconds))
   WHERE live_event_id = _live_event_id AND state = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'bulk_shift', jsonb_build_object('delta', _delta_seconds, 'affected', v_count));
  RETURN jsonb_build_object('status','ok','affected',v_count,'delta',_delta_seconds);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, int) TO authenticated;

-- preview (counts + delta between drafts and applied)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_preview(_live_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_draft int; v_applied int; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  SELECT count(*) INTO v_draft FROM public.autoweb_scenario_entries
    WHERE live_event_id = _live_event_id AND state = 'draft';
  SELECT count(*) INTO v_applied FROM public.autoweb_scenario_entries
    WHERE live_event_id = _live_event_id AND state = 'applied';
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'preview', jsonb_build_object('draft',v_draft,'applied',v_applied));
  RETURN jsonb_build_object('status','ok','draft_count',v_draft,'applied_count',v_applied);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_preview(uuid) TO authenticated;

-- apply (drafts -> applied)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_apply(_live_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  UPDATE public.autoweb_scenario_entries
     SET state = 'applied', applied_at = now()
   WHERE live_event_id = _live_event_id AND state = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'apply', jsonb_build_object('applied', v_count));
  RETURN jsonb_build_object('status','ok','applied',v_count);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_apply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_apply(uuid) TO authenticated;

-- cancel (archive all drafts)
CREATE OR REPLACE FUNCTION public.autoweb_scenario_cancel(_live_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  UPDATE public.autoweb_scenario_entries
     SET state = 'archived'
   WHERE live_event_id = _live_event_id AND state = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'cancel', jsonb_build_object('cancelled', v_count));
  RETURN jsonb_build_object('status','ok','cancelled',v_count);
END; $$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_cancel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_cancel(uuid) TO authenticated;
