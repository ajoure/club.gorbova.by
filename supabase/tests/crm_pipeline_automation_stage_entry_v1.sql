-- Run after 20260723092218_crm_pipeline_automation_stage_entry_v1.sql.
-- Structural regression checks; all failures abort the transaction.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.crm_pipeline_automation_rules') IS NULL THEN
    RAISE EXCEPTION 'missing crm_pipeline_automation_rules';
  END IF;
  IF to_regclass('public.crm_pipeline_automation_jobs') IS NULL THEN
    RAISE EXCEPTION 'missing crm_pipeline_automation_jobs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('crm_pipeline_automation_rules','crm_pipeline_automation_jobs')
      AND c.relrowsecurity
    GROUP BY n.nspname
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on both automation tables';
  END IF;
  IF to_regprocedure('public.crm_pipeline_automation_claim_jobs(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'missing claim RPC';
  END IF;
  IF to_regprocedure('public.crm_pipeline_automation_complete_job(uuid,boolean,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'missing completion RPC';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_claim_jobs(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute claim RPC';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.crm_pipeline_automation_claim_jobs(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute claim RPC';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'crm_pipeline_automation_one_editable_version_idx'
      AND indexdef ILIKE '%UNIQUE%'
  ) THEN
    RAISE EXCEPTION 'missing editable-version uniqueness guard';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_crm_pipeline_automation_stage_entry'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'missing deal stage enqueue trigger';
  END IF;
END;
$$;

ROLLBACK;
