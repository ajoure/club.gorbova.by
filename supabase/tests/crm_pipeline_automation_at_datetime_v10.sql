BEGIN;

SELECT plan(6);

SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'scheduled_local_at',
  'date/time trigger stores a local timestamp'
);
SELECT has_column(
  'public', 'crm_pipeline_automation_rules', 'scheduled_fired_at',
  'date/time trigger has a consumption marker'
);
SELECT has_check(
  'public', 'crm_pipeline_automation_rules',
  'crm_pipeline_automation_schedule_config_v10_chk',
  'schedule configuration matches its trigger type'
);
SELECT has_function(
  'public', 'crm_pipeline_automation_enqueue_due_schedules_v10',
  'worker can atomically materialize due one-off schedules'
);
SELECT has_trigger(
  'public', 'crm_pipeline_automation_rules',
  'trg_crm_pipeline_automation_validate_schedule_v10',
  'published schedule snapshots are guarded'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_pipeline_automation_enqueue_due_schedules_v10()',
    'EXECUTE'
  ),
  'authenticated users cannot materialize schedules'
);

SELECT * FROM finish();

ROLLBACK;
