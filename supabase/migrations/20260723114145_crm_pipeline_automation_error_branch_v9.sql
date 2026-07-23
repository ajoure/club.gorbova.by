BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN error_branch_task_type_id uuid REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  ADD COLUMN error_branch_title_template text,
  ADD COLUMN error_branch_description_template text,
  ADD COLUMN error_branch_assignee_strategy text,
  ADD COLUMN error_branch_assignee_user_id uuid,
  ADD COLUMN error_branch_due_offset_minutes integer,
  ADD CONSTRAINT crm_pipeline_automation_error_branch_config_chk CHECK (
    (
      error_branch_task_type_id IS NULL
      AND error_branch_title_template IS NULL
      AND error_branch_description_template IS NULL
      AND error_branch_assignee_strategy IS NULL
      AND error_branch_assignee_user_id IS NULL
      AND error_branch_due_offset_minutes IS NULL
    ) OR (
      error_branch_task_type_id IS NOT NULL
      AND length(btrim(error_branch_title_template)) BETWEEN 1 AND 240
      AND error_branch_assignee_strategy IN ('deal_owner','fixed_user')
      AND (error_branch_assignee_strategy <> 'fixed_user' OR error_branch_assignee_user_id IS NOT NULL)
      AND error_branch_due_offset_minutes BETWEEN 0 AND 525600
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_error_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived')
    AND ROW(
      NEW.error_branch_task_type_id, NEW.error_branch_title_template,
      NEW.error_branch_description_template, NEW.error_branch_assignee_strategy,
      NEW.error_branch_assignee_user_id, NEW.error_branch_due_offset_minutes
    ) IS DISTINCT FROM ROW(
      OLD.error_branch_task_type_id, OLD.error_branch_title_template,
      OLD.error_branch_description_template, OLD.error_branch_assignee_strategy,
      OLD.error_branch_assignee_user_id, OLD.error_branch_due_offset_minutes
    )
  THEN
    RAISE EXCEPTION 'published_automation_version_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_automation_validate_error_branch
  ON public.crm_pipeline_automation_rules;
CREATE TRIGGER trg_crm_pipeline_automation_validate_error_branch
  BEFORE INSERT OR UPDATE ON public.crm_pipeline_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_validate_error_branch();

COMMIT;
