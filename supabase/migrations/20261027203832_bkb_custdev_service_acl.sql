-- Supabase default privileges can grant ALL to service_role when tables are
-- created. A narrow GRANT alone does not remove those inherited table grants.
-- Keep the original migration immutable; narrow its actual relation ACLs here.
BEGIN;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE oid IN (
    to_regclass('public.training_custdev_workspaces'),
    to_regclass('public.training_custdev_ai_runs'),
    to_regclass('public.training_custdev_versions')
  ) AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'custdev_schema_not_ready';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
    'public.training_custdev_workspaces'::regclass,
    'public.training_custdev_ai_runs'::regclass,
    'public.training_custdev_versions'::regclass
  ) AND relowner=(SELECT oid FROM pg_roles WHERE rolname='service_role')) THEN
    RAISE EXCEPTION 'custdev_service_role_is_owner';
  END IF;
END;
$guard$;

REVOKE ALL PRIVILEGES ON public.training_custdev_workspaces,
  public.training_custdev_ai_runs,public.training_custdev_versions FROM service_role;
REVOKE UPDATE(status,result,error_code,finished_at)
  ON public.training_custdev_ai_runs FROM service_role;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_custdev_workspaces TO service_role;
GRANT SELECT,INSERT ON public.training_custdev_ai_runs TO service_role;
GRANT UPDATE(status,result,error_code,finished_at)
  ON public.training_custdev_ai_runs TO service_role;
GRANT SELECT,INSERT ON public.training_custdev_versions TO service_role;

DO $verify$
DECLARE t text; c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_custdev_workspaces','training_custdev_ai_runs','training_custdev_versions'] LOOP
    IF NOT has_table_privilege('service_role','public.'||t,'SELECT')
      OR NOT has_table_privilege('service_role','public.'||t,'INSERT')
      OR has_table_privilege('service_role','public.'||t,'TRUNCATE')
      OR has_table_privilege('service_role','public.'||t,'TRIGGER')
      OR has_table_privilege('service_role','public.'||t,'REFERENCES') THEN
      RAISE EXCEPTION 'custdev_unexpected_service_acl: %',t;
    END IF;
    IF t<>'training_custdev_workspaces' AND (
      has_table_privilege('service_role','public.'||t,'UPDATE') OR
      has_table_privilege('service_role','public.'||t,'DELETE')
    ) THEN RAISE EXCEPTION 'custdev_history_table_write_granted: %',t; END IF;
  END LOOP;
  FOR c IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.training_custdev_ai_runs'::regclass AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege('service_role','public.training_custdev_ai_runs',c.attname,'UPDATE')
      IS DISTINCT FROM (c.attname IN ('status','result','error_code','finished_at')) THEN
      RAISE EXCEPTION 'custdev_unexpected_ai_column_acl: %',c.attname;
    END IF;
  END LOOP;
  IF has_any_column_privilege('service_role','public.training_custdev_versions','UPDATE') THEN
    RAISE EXCEPTION 'custdev_versions_mutable';
  END IF;
END;
$verify$;
COMMIT;
