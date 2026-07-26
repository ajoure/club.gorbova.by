BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_pipeline_automation_rules'
      AND column_name = 'telegram_message_template'
  ) THEN
    RAISE EXCEPTION 'missing telegram_message_template';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'crm_pipeline_automation_rules_action_type_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%send_telegram%'
  ) THEN
    RAISE EXCEPTION 'send_telegram action is not constrained';
  END IF;
END;
$$;

ROLLBACK;
