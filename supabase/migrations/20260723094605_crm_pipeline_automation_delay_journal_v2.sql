BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN delay_minutes integer NOT NULL DEFAULT 0
    CHECK (delay_minutes BETWEEN 0 AND 525600),
  ADD COLUMN require_same_stage boolean NOT NULL DEFAULT true;

ALTER TABLE public.crm_pipeline_automation_jobs
  DROP CONSTRAINT crm_pipeline_automation_jobs_status_check,
  ADD CONSTRAINT crm_pipeline_automation_jobs_status_check
    CHECK (status IN ('pending','running','succeeded','skipped','failed','dead'));

CREATE INDEX crm_pipeline_automation_jobs_rule_created_idx
  ON public.crm_pipeline_automation_jobs(rule_id, created_at DESC);

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

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.conditions
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

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_stage_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _event_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deleted OR NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.pipeline_stage_id IS NOT DISTINCT FROM OLD.pipeline_stage_id THEN
    RETURN NEW;
  END IF;

  _event_key := concat(
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'moved' END,
    ':', CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.pipeline_stage_id::text, 'none') ELSE 'none' END,
    ':', NEW.pipeline_stage_id::text
  );

  INSERT INTO public.crm_pipeline_automation_jobs(
    rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
  )
  SELECT
    r.id, r.logical_id, r.version, NEW.id, _event_key,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'old_stage_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.pipeline_stage_id ELSE NULL END,
      'new_stage_id', NEW.pipeline_stage_id,
      'occurred_at', now()
    ),
    now() + make_interval(mins => r.delay_minutes)
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_skip_job(
  _job_id uuid,
  _reason text,
  _result jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.crm_pipeline_automation_jobs
  SET status = 'skipped',
      result = coalesce(_result, '{}'::jsonb) || jsonb_build_object('skip_reason', _reason),
      last_error = NULL,
      finished_at = now(),
      locked_at = NULL,
      locked_by = NULL
  WHERE id = _job_id AND status = 'running';
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_skip_job(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_skip_job(uuid, text, jsonb)
  TO service_role;

COMMIT;
