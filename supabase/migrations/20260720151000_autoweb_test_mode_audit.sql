-- Test preview is client-local by design. Record only the operator's start/stop
-- intent; do not create a session, progress row, notification or integration.

CREATE OR REPLACE FUNCTION public.autoweb_scenario_test_mode_audit(
  _live_event_id uuid,
  _active boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  PERFORM public._autoweb_scenario_require_admin();
  INSERT INTO public.autoweb_scenario_audit(live_event_id, actor_user_id, action, payload)
  VALUES (
    _live_event_id,
    v_actor,
    CASE WHEN _active THEN 'test_mode_started' ELSE 'test_mode_stopped' END,
    jsonb_build_object('isolated', true)
  );
  RETURN jsonb_build_object('status', 'ok', 'active', _active);
END;
$$;

REVOKE ALL ON FUNCTION public.autoweb_scenario_test_mode_audit(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autoweb_scenario_test_mode_audit(uuid, boolean) TO authenticated;
