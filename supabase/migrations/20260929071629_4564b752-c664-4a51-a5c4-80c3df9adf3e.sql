-- Preserve the already-applied CB21 release configuration and change only
-- the audit actor type. Admins are authenticated users in audit_logs.
BEGIN;
DO $fix$
DECLARE
  definition text;
  previous_actor text := $old$CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'admin' END$old$;
  corrected_actor text := $new$CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END$new$;
BEGIN
  SELECT pg_get_functiondef('private.sync_cb21_learning_release()'::regprocedure) INTO definition;
  IF strpos(definition,previous_actor)=0 THEN
    RAISE EXCEPTION 'cb21_audit_actor_preflight_drift';
  END IF;
  EXECUTE replace(definition,previous_actor,corrected_actor);
END;
$fix$;
COMMIT;