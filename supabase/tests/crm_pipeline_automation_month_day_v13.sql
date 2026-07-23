BEGIN;

SELECT plan(6);

SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'recurrence_month_day',
  'monthly trigger stores a numbered day'
);
SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'recurrence_month_last',
  'monthly trigger can select the last day'
);
SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'recurrence_month_key',
  'monthly trigger has an idempotency marker'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v13_chk',
  'month-day configuration is constrained by trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_due_month_days_v13',
  'worker can atomically materialize due monthly rules'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_due_month_days_v13()',
    'EXECUTE'
  ),
  'authenticated users cannot materialize month-day schedules'
);

SELECT * FROM finish();

ROLLBACK;
