BEGIN;

SELECT plan(9);

SELECT ok(
  public.crm_pipeline_automation_conditions_valid('{}'::jsonb),
  'empty condition object matches all deals'
);
SELECT ok(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"and","items":[{"field":"status","operator":"eq","value":"paid"}]}'::jsonb
  ),
  'a supported AND predicate is valid'
);
SELECT ok(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"or","items":[{"field":"customer_email","operator":"contains","value":"@example.com","not":true}]}'::jsonb
  ),
  'OR and NOT are valid'
);
SELECT ok(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"and","items":[{"field":"final_price","operator":"gte","value":100}]}'::jsonb
  ),
  'numeric comparisons require numeric values'
);
SELECT isnt(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"and","items":[{"field":"final_price","operator":"gte","value":"100"}]}'::jsonb
  ),
  true,
  'numeric strings are rejected'
);
SELECT isnt(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"and","items":[{"field":"meta","operator":"eq","value":"unsafe"}]}'::jsonb
  ),
  true,
  'unlisted fields are rejected'
);
SELECT isnt(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"xor","items":[{"field":"status","operator":"eq","value":"paid"}]}'::jsonb
  ),
  true,
  'unsupported group logic is rejected'
);
SELECT isnt(
  public.crm_pipeline_automation_conditions_valid(
    '{"logic":"and","items":[{"field":"status","operator":"eq","value":"paid","unsafe":true}]}'::jsonb
  ),
  true,
  'unknown predicate keys are rejected'
);
SELECT has_check(
  'public',
  'crm_pipeline_automation_rules',
  'crm_pipeline_automation_conditions_shape_chk',
  'rules enforce the validated condition shape'
);

SELECT * FROM finish();

ROLLBACK;
