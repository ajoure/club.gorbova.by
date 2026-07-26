BEGIN;

DO $$
DECLARE
  _shifted timestamptz;
  _unchanged timestamptz;
BEGIN
  IF to_regprocedure(
    'public.crm_pipeline_automation_next_available_at(timestamp with time zone,integer,text,time without time zone,time without time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing scheduling helper';
  END IF;
  IF to_regprocedure('public.crm_pipeline_automation_retry_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'missing retry RPC';
  END IF;
  IF has_function_privilege(
    'anon', 'public.crm_pipeline_automation_retry_job(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not retry automation jobs';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_next_available_at(timestamp with time zone,integer,text,time without time zone,time without time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'scheduling helper must remain internal';
  END IF;

  _shifted := public.crm_pipeline_automation_next_available_at(
    '2026-07-23 21:30:00+00', 0, 'Europe/Warsaw', '22:00'::time, '08:00'::time
  );
  IF _shifted <> '2026-07-24 06:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'overnight quiet hours mismatch: %', _shifted;
  END IF;

  _unchanged := public.crm_pipeline_automation_next_available_at(
    '2026-07-23 10:00:00+00', 30, 'Europe/Warsaw', '22:00'::time, '08:00'::time
  );
  IF _unchanged <> '2026-07-23 10:30:00+00'::timestamptz THEN
    RAISE EXCEPTION 'allowed window mismatch: %', _unchanged;
  END IF;
END;
$$;

ROLLBACK;
