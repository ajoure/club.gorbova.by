
-- PATCH B: training_content DB guards
-- 1. Partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_rules_tc_product_unique
ON access_rules (product_id, grant_target_type, target_ref)
WHERE tariff_id IS NULL AND grant_target_type = 'training_content';

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_rules_tc_tariff_unique
ON access_rules (product_id, tariff_id, grant_target_type, target_ref)
WHERE tariff_id IS NOT NULL AND grant_target_type = 'training_content';

-- 2. Runtime lookup index
CREATE INDEX IF NOT EXISTS idx_access_rules_tc_runtime
ON access_rules (target_ref, grant_target_type, is_active)
WHERE grant_target_type = 'training_content' AND is_active = true;

-- 3. Validation trigger
CREATE OR REPLACE FUNCTION validate_training_content_rule()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grant_target_type = 'training_content' THEN
    -- Must be root module (parent_module_id IS NULL)
    IF NOT EXISTS (
      SELECT 1 FROM training_modules
      WHERE id::text = NEW.target_ref
        AND parent_module_id IS NULL
    ) THEN
      RAISE EXCEPTION 'training_content rule target must be a root training module (parent_module_id IS NULL)';
    END IF;

    -- product_id must match training's product_id
    IF NOT EXISTS (
      SELECT 1 FROM training_modules
      WHERE id::text = NEW.target_ref
        AND product_id = COALESCE(
          NEW.product_id,
          (SELECT product_id FROM tariffs WHERE id = NEW.tariff_id)
        )
    ) THEN
      RAISE EXCEPTION 'training_content rule product must match training module product_id';
    END IF;

    -- Validate conditions schema
    IF NEW.conditions IS NOT NULL THEN
      -- access_mode must be present
      IF NEW.conditions->>'access_mode' IS NULL THEN
        RAISE EXCEPTION 'training_content rule must have access_mode in conditions';
      END IF;
      -- partial requires non-empty allowlists
      IF NEW.conditions->>'access_mode' = 'partial' THEN
        IF (
          COALESCE(jsonb_array_length(NEW.conditions->'allowed_module_ids'), 0) = 0
          AND COALESCE(jsonb_array_length(NEW.conditions->'allowed_lesson_ids'), 0) = 0
        ) THEN
          RAISE EXCEPTION 'partial access_mode requires non-empty allowed_module_ids or allowed_lesson_ids';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'training_content rule must have conditions with access_mode';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_training_content ON access_rules;
CREATE TRIGGER trg_validate_training_content
BEFORE INSERT OR UPDATE ON access_rules
FOR EACH ROW
EXECUTE FUNCTION validate_training_content_rule();
