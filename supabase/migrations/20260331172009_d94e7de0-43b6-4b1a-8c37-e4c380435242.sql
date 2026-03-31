ALTER TABLE access_rules DROP CONSTRAINT IF EXISTS access_rules_grant_target_type_check;
ALTER TABLE access_rules ADD CONSTRAINT access_rules_grant_target_type_check
  CHECK (grant_target_type = ANY (ARRAY['entitlement'::text, 'club'::text, 'email'::text, 'product_access'::text, 'training_content'::text]));