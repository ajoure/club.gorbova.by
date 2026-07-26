BEGIN;

SELECT plan(3);

SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_type_v11_chk',
  'after_event is an allowed persisted trigger'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v11_chk',
  'after_event requires a positive delay'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_stage_entry',
  'stage entry function continues to enqueue supported event triggers'
);

SELECT * FROM finish();

ROLLBACK;
