BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_rules_action_type_check,
  DROP CONSTRAINT crm_pipeline_automation_action_config_chk,
  ADD COLUMN telegram_message_template text,
  ADD CONSTRAINT crm_pipeline_automation_rules_action_type_check
    CHECK (action_type IN ('create_task','send_email','send_telegram')),
  ADD CONSTRAINT crm_pipeline_automation_action_config_chk CHECK (
    (
      action_type = 'create_task'
      AND task_type_id IS NOT NULL
      AND title_template IS NOT NULL
      AND length(btrim(title_template)) BETWEEN 1 AND 240
      AND email_template_id IS NULL
      AND email_subject_template IS NULL
      AND email_html_template IS NULL
      AND telegram_message_template IS NULL
    )
    OR
    (
      action_type = 'send_email'
      AND task_type_id IS NULL
      AND title_template IS NULL
      AND email_template_id IS NOT NULL
      AND email_subject_template IS NOT NULL
      AND length(btrim(email_subject_template)) BETWEEN 1 AND 500
      AND email_html_template IS NOT NULL
      AND length(btrim(email_html_template)) BETWEEN 1 AND 200000
      AND telegram_message_template IS NULL
    )
    OR
    (
      action_type = 'send_telegram'
      AND task_type_id IS NULL
      AND title_template IS NULL
      AND email_template_id IS NULL
      AND email_subject_template IS NULL
      AND email_html_template IS NULL
      AND telegram_message_template IS NOT NULL
      AND length(btrim(telegram_message_template)) BETWEEN 1 AND 4096
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_email_template_not_active' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end,
      NEW.email_template_id, NEW.email_account_id, NEW.email_subject_template,
      NEW.email_html_template, NEW.email_text_template, NEW.recipient_strategy,
      NEW.telegram_message_template, NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.telegram_message_template, OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

COMMIT;
