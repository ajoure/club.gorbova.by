BEGIN;

SELECT plan(7);

SELECT has_column(
  'public',
  'crm_pipeline_automation_rules',
  'fallback_action_type',
  'rules expose a fallback action'
);
SELECT has_column(
  'public',
  'crm_pipeline_automation_rules',
  'fallback_email_template_id',
  'rules snapshot a fallback email template'
);
SELECT has_column(
  'public',
  'crm_pipeline_automation_rules',
  'fallback_telegram_message_template',
  'rules snapshot a fallback Telegram message'
);
SELECT col_is_nullable(
  'public',
  'crm_pipeline_automation_rules',
  'fallback_action_type',
  'fallback is optional'
);
SELECT has_check(
  'public',
  'crm_pipeline_automation_rules',
  'crm_pipeline_automation_fallback_action_type_chk',
  'fallback is restricted to the opposite messaging channel'
);
SELECT has_check(
  'public',
  'crm_pipeline_automation_rules',
  'crm_pipeline_automation_fallback_config_chk',
  'fallback configuration is internally consistent'
);
SELECT function_returns(
  'public',
  'crm_pipeline_automation_validate_rule',
  ARRAY[]::text[],
  'trigger',
  'published fallback snapshots are protected by the rule validator'
);

SELECT * FROM finish();

ROLLBACK;
