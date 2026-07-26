BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_pipeline_automation_rules'
      AND column_name = 'email_template_id'
  ) THEN
    RAISE EXCEPTION 'missing email_template_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'email_logs_automation_idempotency_idx'
      AND indexdef ILIKE '%UNIQUE%'
  ) THEN
    RAISE EXCEPTION 'missing email idempotency guard';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_pipeline_automation_action_config_chk'
  ) THEN
    RAISE EXCEPTION 'missing action-specific configuration guard';
  END IF;
END;
$$;

ROLLBACK;
