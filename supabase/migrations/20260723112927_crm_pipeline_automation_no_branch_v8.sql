BEGIN;

-- Pipeline rules are a separate versioned domain from the legacy offer-level
-- crm_task_automation_rules. Keep their idempotency key in a dedicated column
-- instead of overloading the legacy foreign key.
ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS pipeline_automation_rule_id uuid
    REFERENCES public.crm_pipeline_automation_rules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_pipeline_automation_rule_deal_uniq
  ON public.crm_tasks (pipeline_automation_rule_id, deal_id)
  WHERE pipeline_automation_rule_id IS NOT NULL AND deal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_task_create(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _type_key text;
  _type_id uuid;
  _type_row public.crm_task_types%ROWTYPE;
  _title text;
  _due_at timestamptz;
  _remind_at timestamptz;
  _source text;
  _new_id uuid;
  _company_id uuid;
  _company public.companies%ROWTYPE;
BEGIN
  PERFORM public._crm_tasks_assert_staff();
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023';
  END IF;
  _title := nullif(trim(payload->>'title'),'');
  IF _title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='22023'; END IF;
  IF payload ? 'task_type_id' AND nullif(payload->>'task_type_id','') IS NOT NULL THEN
    _type_id := (payload->>'task_type_id')::uuid;
    SELECT * INTO _type_row FROM public.crm_task_types WHERE id=_type_id;
  ELSIF payload ? 'task_type' AND nullif(payload->>'task_type','') IS NOT NULL THEN
    _type_key := payload->>'task_type';
    SELECT * INTO _type_row FROM public.crm_task_types WHERE key=_type_key AND is_active=true;
  ELSE
    RAISE EXCEPTION 'task_type_required' USING ERRCODE='22023';
  END IF;
  IF _type_row.id IS NULL THEN RAISE EXCEPTION 'task_type_not_found' USING ERRCODE='22023'; END IF;
  _company_id := nullif(payload->>'company_id','')::uuid;
  IF _company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id=_company_id;
    IF _company.id IS NULL OR _company.status <> 'active' THEN
      RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023';
    END IF;
  END IF;
  IF payload ? 'due_at' AND nullif(payload->>'due_at','') IS NOT NULL THEN
    _due_at := (payload->>'due_at')::timestamptz;
  ELSIF _type_row.default_due_offset_minutes IS NOT NULL THEN
    _due_at := now() + make_interval(mins => _type_row.default_due_offset_minutes);
  END IF;
  IF payload ? 'remind_at' AND nullif(payload->>'remind_at','') IS NOT NULL THEN
    _remind_at := (payload->>'remind_at')::timestamptz;
  ELSIF _due_at IS NOT NULL AND _type_row.default_reminder_offset_minutes IS NOT NULL THEN
    _remind_at := _due_at - make_interval(mins => _type_row.default_reminder_offset_minutes);
  END IF;
  _source := coalesce(nullif(payload->>'source',''),'manual');
  IF _source NOT IN ('manual','auto','system') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;

  INSERT INTO public.crm_tasks(
    task_type_id,title,description,contact_id,company_id,deal_id,order_id,
    pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,assignee_user_id,
    due_at,remind_at,status,source,automation_rule_id,pipeline_automation_rule_id,
    created_by,updated_by,meta
  ) VALUES (
    _type_row.id,_title,nullif(payload->>'description',''),
    nullif(payload->>'contact_id','')::uuid,_company_id,
    nullif(payload->>'deal_id','')::uuid,nullif(payload->>'order_id','')::uuid,
    nullif(payload->>'pipeline_id','')::uuid,nullif(payload->>'pipeline_stage_id','')::uuid,
    nullif(payload->>'offer_id','')::uuid,nullif(payload->>'product_id','')::uuid,
    nullif(payload->>'tariff_id','')::uuid,nullif(payload->>'assignee_user_id','')::uuid,
    _due_at,_remind_at,coalesce(nullif(payload->>'status',''),'open'),_source,
    nullif(payload->>'automation_rule_id','')::uuid,
    nullif(payload->>'pipeline_automation_rule_id','')::uuid,
    _uid,_uid,coalesce(payload->'meta','{}'::jsonb)
  ) RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN no_branch_task_type_id uuid REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  ADD COLUMN no_branch_title_template text,
  ADD COLUMN no_branch_description_template text,
  ADD COLUMN no_branch_assignee_strategy text,
  ADD COLUMN no_branch_assignee_user_id uuid,
  ADD COLUMN no_branch_due_offset_minutes integer,
  ADD CONSTRAINT crm_pipeline_automation_no_branch_config_chk CHECK (
    (
      no_branch_task_type_id IS NULL
      AND no_branch_title_template IS NULL
      AND no_branch_description_template IS NULL
      AND no_branch_assignee_strategy IS NULL
      AND no_branch_assignee_user_id IS NULL
      AND no_branch_due_offset_minutes IS NULL
    ) OR (
      no_branch_task_type_id IS NOT NULL
      AND length(btrim(no_branch_title_template)) BETWEEN 1 AND 240
      AND no_branch_assignee_strategy IN ('deal_owner','fixed_user')
      AND (no_branch_assignee_strategy <> 'fixed_user' OR no_branch_assignee_user_id IS NOT NULL)
      AND no_branch_due_offset_minutes BETWEEN 0 AND 525600
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
  IF NEW.fallback_action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.fallback_email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_fallback_email_template_not_active' USING ERRCODE = '22023';
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
      NEW.telegram_message_template, NEW.fallback_action_type,
      NEW.fallback_email_template_id, NEW.fallback_email_account_id,
      NEW.fallback_email_subject_template, NEW.fallback_email_html_template,
      NEW.fallback_email_text_template, NEW.fallback_telegram_message_template,
      NEW.no_branch_task_type_id, NEW.no_branch_title_template,
      NEW.no_branch_description_template, NEW.no_branch_assignee_strategy,
      NEW.no_branch_assignee_user_id, NEW.no_branch_due_offset_minutes,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.telegram_message_template, OLD.fallback_action_type,
      OLD.fallback_email_template_id, OLD.fallback_email_account_id,
      OLD.fallback_email_subject_template, OLD.fallback_email_html_template,
      OLD.fallback_email_text_template, OLD.fallback_telegram_message_template,
      OLD.no_branch_task_type_id, OLD.no_branch_title_template,
      OLD.no_branch_description_template, OLD.no_branch_assignee_strategy,
      OLD.no_branch_assignee_user_id, OLD.no_branch_due_offset_minutes,
      OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

COMMIT;
