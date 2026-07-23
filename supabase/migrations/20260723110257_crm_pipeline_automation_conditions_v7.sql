BEGIN;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_conditions_valid(_conditions jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  _item jsonb;
  _operator text;
  _field text;
  _key_count integer;
BEGIN
  IF _conditions = '{}'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(_conditions) <> 'object' THEN RETURN false; END IF;
  SELECT count(*) INTO _key_count FROM jsonb_object_keys(_conditions);
  IF _key_count > 2
    OR (_conditions->>'logic') NOT IN ('and','or')
    OR jsonb_typeof(_conditions->'items') <> 'array'
    OR jsonb_array_length(_conditions->'items') NOT BETWEEN 1 AND 10
  THEN
    RETURN false;
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_conditions->'items')
  LOOP
    IF jsonb_typeof(_item) <> 'object' THEN RETURN false; END IF;
    SELECT count(*) INTO _key_count FROM jsonb_object_keys(_item);
    IF _key_count > 4 THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(_item) AS keys(key)
      WHERE key NOT IN ('field','operator','value','not')
    ) THEN
      RETURN false;
    END IF;

    _field := _item->>'field';
    _operator := _item->>'operator';
    IF _field NOT IN (
      'status','currency','is_trial','product_id','tariff_id',
      'responsible_user_id','customer_email','paid_amount','final_price'
    ) OR _operator NOT IN (
      'eq','neq','contains','not_contains','is_empty','is_not_empty',
      'gt','gte','lt','lte'
    ) THEN
      RETURN false;
    END IF;
    IF _item ? 'not' AND jsonb_typeof(_item->'not') <> 'boolean' THEN RETURN false; END IF;
    IF _operator NOT IN ('is_empty','is_not_empty') AND NOT (_item ? 'value') THEN
      RETURN false;
    END IF;
    IF _item ? 'value'
      AND jsonb_typeof(_item->'value') NOT IN ('string','number','boolean','null')
    THEN
      RETURN false;
    END IF;
    IF _operator IN ('contains','not_contains')
      AND _field NOT IN ('status','currency','customer_email')
    THEN
      RETURN false;
    END IF;
    IF _operator IN ('gt','gte','lt','lte') THEN
      IF _field NOT IN ('paid_amount','final_price')
        OR jsonb_typeof(_item->'value') <> 'number'
      THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_conditions_valid(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_conditions_valid(jsonb)
  TO authenticated, service_role;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD CONSTRAINT crm_pipeline_automation_conditions_shape_chk
  CHECK (public.crm_pipeline_automation_conditions_valid(conditions));

COMMENT ON COLUMN public.crm_pipeline_automation_rules.conditions IS
  'Validated v1 condition group: {logic: and|or, items: [{field, operator, value?, not?}]}; max 10 predicates.';

COMMIT;
