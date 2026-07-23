BEGIN;

SELECT plan(4);

SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v14_chk',
  'deal-left configuration is constrained by trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_stage_entry',
  'stage transition function materializes exit jobs'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_stage_entry()',
    'EXECUTE'
  ),
  'authenticated users cannot call the transition enqueue function'
);
SELECT has_trigger(
  'public', 'orders_v2', 'trg_crm_pipeline_automation_stage_entry',
  'orders continue to invoke the internal transition function'
);

SELECT * FROM finish();

ROLLBACK;
