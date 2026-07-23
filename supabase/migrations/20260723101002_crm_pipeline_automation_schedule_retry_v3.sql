BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  ADD COLUMN quiet_hours_start time,
  ADD COLUMN quiet_hours_end time,
  ADD CONSTRAINT crm_pipeline_automation_quiet_hours_pair_chk CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_next_available_at(
  _base timestamptz,
  _delay_minutes integer,
  _timezone text,
  _quiet_start time,
  _quiet_end time
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _candidate timestamptz := _base + make_interval(mins => _delay_minutes);
  _local timestamp;
  _local_time time;
  _resume_local timestamp;
BEGIN
  IF _quiet_start IS NULL OR _quiet_end IS NULL OR _quiet_start = _quiet_end THEN
    RETURN _candidate;
  END IF;

  _local := _candidate AT TIME ZONE _timezone;
  _local_time := _local::time;

  IF _quiet_start < _quiet_end THEN
    IF _local_time >= _quiet_start AND _local_time < _quiet_end THEN
      _resume_local := _local::date + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    END IF;
  ELSE
    IF _local_time >= _quiet_start THEN
      _resume_local := (_local::date + 1) + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    ELSIF _local_time < _quiet_end THEN
      _resume_local := _local::date + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    END IF;
  END IF;

  RETURN _candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_next_available_at(
  timestamptz, integer, text, time, time
) FROM PUBLIC, anon, authenticated;

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

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end, NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end, OLD.conditions
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
  IF NEW.is_deleted OR NEW.pipeline_stage_id IS NULL THEN RETURN NEW; END IF;
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
    public.crm_pipeline_automation_next_available_at(
      now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_retry_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := (select auth.uid());
BEGIN
  IF _uid IS NULL OR NOT (
    public.has_role_v2(_uid, 'admin')
    OR public.has_role_v2(_uid, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.crm_pipeline_automation_jobs
  SET status = 'pending',
      attempt_count = 0,
      available_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      finished_at = NULL,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'manual_retry_at', now(),
        'manual_retry_by', _uid
      )
  WHERE id = _job_id AND status IN ('failed','dead');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_job_not_retryable' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_retry_job(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_retry_job(uuid)
  TO authenticated;

COMMIT;
