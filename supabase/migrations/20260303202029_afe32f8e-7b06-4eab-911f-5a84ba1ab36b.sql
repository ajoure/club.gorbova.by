ALTER TABLE integration_instances
  DROP CONSTRAINT integration_instances_category_check;

ALTER TABLE integration_instances
  ADD CONSTRAINT integration_instances_category_check
  CHECK (category = ANY (ARRAY['crm','payments','email','telegram','socials','other']));