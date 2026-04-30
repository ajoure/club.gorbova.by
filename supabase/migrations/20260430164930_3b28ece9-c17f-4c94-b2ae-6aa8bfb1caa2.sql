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

    IF current_allowed @> to_jsonb(NEW.id::text) THEN
      CONTINUE;
    END IF;

    new_allowed := current_allowed || to_jsonb(NEW.id::text);
    after_conditions := jsonb_set(rule_rec.conditions, '{allowed_module_ids}', new_allowed, true);

    UPDATE public.access_rules
    SET conditions = after_conditions,
        updated_at = now()
    WHERE id = rule_rec.id;

    INSERT INTO public.access_grant_ledger (
      source_event_key, execution_key,
      action_type, status, reason_code,
      source_event_type, source_subject_type, source_subject_ref,
      target_type, target_key, target_ref,
      result, metadata
    ) VALUES (
      'training_module.created:' || NEW.id::text,
      'auto_propagate:' || rule_rec.id::text || ':' || NEW.id::text,
      'grant', 'granted', 'admin_grant',
      'system', 'system', rule_rec.id::text,
      'training_module', NEW.id::text, NEW.id,
      jsonb_build_object('outcome','auto_propagated_new_module','rule_id', rule_rec.id, 'added_module_id', NEW.id),
      jsonb_build_object(
        'before', before_conditions,
        'after', after_conditions,
        'actor', 'system_trigger',
        'parent_module_id', NEW.parent_module_id,
        'reason_detail', 'auto_propagated_new_module'
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;