BEGIN;

SELECT plan(5);

SELECT has_column(
  'public', 'crm_tasks', 'pipeline_automation_rule_id',
  'tasks keep a dedicated pipeline automation idempotency key'
);
SELECT has_index(
  'public', 'crm_tasks', 'crm_tasks_pipeline_automation_rule_deal_uniq',
  'pipeline task effects are unique per rule and deal'
);
SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'no_branch_task_type_id',
  'rules can configure the no branch task type'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_no_branch_config_chk',
  'no branch task configuration is complete or absent'
);
SELECT function_returns(
  'public', 'crm_task_create', ARRAY['jsonb']::text[], 'uuid',
  'canonical task writer accepts pipeline automation payloads'
);

SELECT * FROM finish();

ROLLBACK;
