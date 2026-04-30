-- 1. Backfill: всем активным partial-правилам training_content явно проставить auto_include_new_modules=false
--    Не трогаем full и неактивные.
UPDATE public.access_rules
SET conditions = jsonb_set(
      COALESCE(conditions, '{}'::jsonb),
      '{auto_include_new_modules}',
      'false'::jsonb,
      true
    ),
    updated_at = now()
WHERE grant_target_type = 'training_content'
  AND is_active = true
  AND conditions->>'access_mode' = 'partial'
  AND NOT (conditions ? 'auto_include_new_modules');

-- 2. Trigger function: пропагирует новый дочерний training_module
--    в allowed_module_ids у соответствующих partial+auto_include правил.
CREATE OR REPLACE FUNCTION public.tg_training_module_propagate_to_partial_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule_rec RECORD;
  before_conditions jsonb;
  after_conditions jsonb;
  current_allowed jsonb;
  new_allowed jsonb;
BEGIN
  -- Триггер срабатывает только для дочерних модулей (есть parent_module_id).
  IF NEW.parent_module_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR rule_rec IN
    SELECT id, conditions
    FROM public.access_rules
    WHERE grant_target_type = 'training_content'
      AND is_active = true
      AND target_ref = NEW.parent_module_id::text
      AND conditions->>'access_mode' = 'partial'
      AND COALESCE((conditions->>'auto_include_new_modules')::boolean, false) = true
  LOOP
    before_conditions := rule_rec.conditions;
    current_allowed := COALESCE(rule_rec.conditions->'allowed_module_ids', '[]'::jsonb);

    -- Если новый id уже там — no-op для этого правила.
    IF current_allowed @> to_jsonb(NEW.id::text) THEN
      CONTINUE;
    END IF;

    new_allowed := current_allowed || to_jsonb(NEW.id::text);
    after_conditions := jsonb_set(rule_rec.conditions, '{allowed_module_ids}', new_allowed, true);

    UPDATE public.access_rules
    SET conditions = after_conditions,
        updated_at = now()
    WHERE id = rule_rec.id;

    -- Audit в ledger
    INSERT INTO public.access_grant_ledger (
      source_event_key, execution_key,
      action_type, status, reason_code,
      source_event_type, source_subject_type, source_subject_ref,
      target_type, target_key, target_ref,
      result, metadata
    ) VALUES (
      'training_module.created:' || NEW.id::text,
      'auto_propagate:' || rule_rec.id::text || ':' || NEW.id::text,
      'update', 'success', 'auto_propagated_new_module',
      'training_module_insert', 'access_rule', rule_rec.id::text,
      'access_rule', rule_rec.id::text, rule_rec.id,
      jsonb_build_object('outcome', 'auto_propagated_new_module', 'added_module_id', NEW.id),
      jsonb_build_object(
        'before', before_conditions,
        'after', after_conditions,
        'actor', 'system_trigger',
        'parent_module_id', NEW.parent_module_id
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- 3. Триггер
DROP TRIGGER IF EXISTS tg_training_module_propagate_to_partial_rules ON public.training_modules;
CREATE TRIGGER tg_training_module_propagate_to_partial_rules
AFTER INSERT ON public.training_modules
FOR EACH ROW
EXECUTE FUNCTION public.tg_training_module_propagate_to_partial_rules();

COMMENT ON FUNCTION public.tg_training_module_propagate_to_partial_rules() IS
  'Пропагирует новый дочерний training_module в allowed_module_ids только для access_rules где grant_target_type=training_content, is_active, target_ref=parent_module_id, conditions.access_mode=partial и conditions.auto_include_new_modules=true. Для full и partial+false — no-op. Логирует в access_grant_ledger как outcome=auto_propagated_new_module.';