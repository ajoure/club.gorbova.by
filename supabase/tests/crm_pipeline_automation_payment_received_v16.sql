BEGIN;

SELECT plan(4);

SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_trigger_config_v16_chk',
  'payment-received configuration is constrained by trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_payment_received',
  'confirmed payment function materializes automation jobs'
);
SELECT has_trigger(
  'public', 'payments_v2', 'trg_crm_pipeline_automation_payment_received',
  'payments invoke the dedicated confirmed-payment function'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_payment_received()',
    'EXECUTE'
  ),
  'authenticated users cannot enqueue payment jobs directly'
);

SELECT * FROM finish();

ROLLBACK;
