UPDATE public.document_package_external_form_fields
SET input_rules = COALESCE(input_rules, '{}'::jsonb) || jsonb_build_object('default_today', true)
WHERE id IN (
  '9f1be1b1-e49e-4a26-add4-89b67bdc6035',
  '539eaa8c-8897-4950-9bdc-44c9df274fa9'
);