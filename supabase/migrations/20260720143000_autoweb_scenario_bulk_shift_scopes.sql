-- Scoped bulk shift for the one canonical autoweb scenario store.
-- "comments" covers all non-CTA timeline entries; "buttons" covers CTA only.

DROP FUNCTION IF EXISTS public.autoweb_scenario_bulk_shift(uuid, integer);

CREATE OR REPLACE FUNCTION public.autoweb_scenario_bulk_shift_preview(
  _live_event_id uuid,
  _delta_seconds integer,
  _scope text DEFAULT 'all'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer := 0;
  v_sample jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  IF _scope NOT IN ('comments', 'buttons', 'all') THEN
    RAISE EXCEPTION 'invalid bulk shift scope';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.autoweb_scenario_entries
  WHERE live_event_id = _live_event_id
    AND state = 'draft'
    AND (
      _scope = 'all'
      OR (_scope = 'buttons' AND entry_type = 'cta')
      OR (_scope = 'comments' AND entry_type <> 'cta')
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'entry_type', entry_type,
    'from_offset_seconds', offset_seconds,
    'to_offset_seconds', GREATEST(0, LEAST(86400, offset_seconds + _delta_seconds))
  ) ORDER BY offset_seconds, created_at), '[]'::jsonb)
  INTO v_sample
  FROM (
    SELECT id, entry_type, offset_seconds, created_at
    FROM public.autoweb_scenario_entries
    WHERE live_event_id = _live_event_id
      AND state = 'draft'
      AND (
        _scope = 'all'
        OR (_scope = 'buttons' AND entry_type = 'cta')
        OR (_scope = 'comments' AND entry_type <> 'cta')
      )
    ORDER BY offset_seconds, created_at
    LIMIT 20
  ) AS preview_rows;

  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'bulk_shift_preview', jsonb_build_object(
    'scope', _scope,
    'delta_seconds', _delta_seconds,
    'affected', v_count
  ));

  RETURN jsonb_build_object(
    'status', 'ok',
    'scope', _scope,
    'delta_seconds', _delta_seconds,
    'affected', v_count,
    'sample', v_sample
  );
END;
$$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_bulk_shift_preview(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_bulk_shift_preview(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.autoweb_scenario_bulk_shift(
  _live_event_id uuid,
  _delta_seconds integer,
  _scope text DEFAULT 'all'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer := 0;
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  IF _scope NOT IN ('comments', 'buttons', 'all') THEN
    RAISE EXCEPTION 'invalid bulk shift scope';
  END IF;

  UPDATE public.autoweb_scenario_entries
     SET offset_seconds = GREATEST(0, LEAST(86400, offset_seconds + _delta_seconds))
   WHERE live_event_id = _live_event_id
     AND state = 'draft'
     AND (
       _scope = 'all'
       OR (_scope = 'buttons' AND entry_type = 'cta')
       OR (_scope = 'comments' AND entry_type <> 'cta')
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (_live_event_id, v_actor, 'bulk_shift_apply', jsonb_build_object(
    'scope', _scope,
    'delta_seconds', _delta_seconds,
    'affected', v_count
  ));

  RETURN jsonb_build_object('status', 'ok', 'scope', _scope, 'affected', v_count, 'delta_seconds', _delta_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_bulk_shift(uuid, integer, text) TO authenticated;
