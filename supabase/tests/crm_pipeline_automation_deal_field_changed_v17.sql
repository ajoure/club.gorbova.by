BEGIN;

SELECT plan(5);

SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'trigger_field',
  'field-change rules retain the selected whitelisted deal field'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v17_chk',
  'field-change configuration is constrained by trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_deal_field_changed',
  'deal-field function materializes automation jobs'
);
SELECT has_trigger(
  'public', 'orders_v2', 'trg_crm_pipeline_automation_deal_field_changed',
  'whitelisted deal updates invoke the dedicated automation function'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_deal_field_changed()',
    'EXECUTE'
  ),
  'authenticated users cannot enqueue deal-field jobs directly'
);

SELECT * FROM finish();

ROLLBACK;
