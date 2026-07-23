BEGIN;

SELECT plan(4);

SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'error_branch_task_type_id',
  'rules can configure an error branch task'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_error_branch_config_chk',
  'error branch task configuration is complete or absent'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_validate_error_branch',
  'published error branch snapshots are guarded'
);
SELECT has_trigger(
  'public', 'crm_pipeline_automation_rules',
  'trg_crm_pipeline_automation_validate_error_branch',
  'error branch guard runs on rule updates'
);

SELECT * FROM finish();

ROLLBACK;
