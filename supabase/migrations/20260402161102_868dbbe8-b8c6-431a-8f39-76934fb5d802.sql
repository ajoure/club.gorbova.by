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

    -- NOTE: product_id match check REMOVED to support multi-product training usage via access_rules.
    -- Training can be owned by a different product and accessed through rules.

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