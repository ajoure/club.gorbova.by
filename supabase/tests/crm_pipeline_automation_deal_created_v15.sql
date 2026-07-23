BEGIN;

SELECT plan(4);

SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v15_chk',
  'deal-created configuration is constrained by trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_deal_created',
  'order INSERT function materializes create-event jobs'
);
SELECT has_trigger(
  'public', 'orders_v2', 'trg_crm_pipeline_automation_deal_created',
  'orders insert invokes the dedicated create-event function'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_deal_created()',
    'EXECUTE'
  ),
  'authenticated users cannot enqueue deal-created jobs directly'
);

SELECT * FROM finish();

ROLLBACK;
