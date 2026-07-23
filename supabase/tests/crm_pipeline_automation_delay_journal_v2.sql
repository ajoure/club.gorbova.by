-- Run after both CRM pipeline automation migrations.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_pipeline_automation_rules'
      AND column_name = 'delay_minutes'
  ) THEN
    RAISE EXCEPTION 'missing delay_minutes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_pipeline_automation_rules'
      AND column_name = 'require_same_stage'
  ) THEN
    RAISE EXCEPTION 'missing require_same_stage';
  END IF;
  IF to_regprocedure('public.crm_pipeline_automation_skip_job(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'missing skip RPC';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_skip_job(uuid,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute skip RPC';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.crm_pipeline_automation_skip_job(uuid,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute skip RPC';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'crm_pipeline_automation_jobs_rule_created_idx'
  ) THEN
    RAISE EXCEPTION 'missing journal lookup index';
  END IF;
END;
$$;

ROLLBACK;
