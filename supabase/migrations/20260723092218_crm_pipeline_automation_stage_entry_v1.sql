BEGIN;

-- Stage 1: pipeline stage entry -> canonical CRM task.
-- Add-only. Existing offer-level crm_task_automation_rules remain untouched.

CREATE TABLE public.crm_pipeline_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES public.crm_pipeline_stages(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  trigger_type text NOT NULL DEFAULT 'deal_entered_stage'
    CHECK (trigger_type IN ('deal_entered_stage')),
  action_type text NOT NULL DEFAULT 'create_task'
    CHECK (action_type IN ('create_task')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','archived')),
  task_type_id uuid NOT NULL REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  title_template text NOT NULL CHECK (length(btrim(title_template)) BETWEEN 1 AND 240),
  description_template text,
  assignee_strategy text NOT NULL DEFAULT 'deal_owner'
    CHECK (assignee_strategy IN ('deal_owner','fixed_user')),
  assignee_user_id uuid,
  due_offset_minutes integer NOT NULL DEFAULT 1440
    CHECK (due_offset_minutes BETWEEN 0 AND 525600),
  reminder_offset_minutes integer CHECK (
    reminder_offset_minutes IS NULL OR
    (reminder_offset_minutes >= 0 AND reminder_offset_minutes < due_offset_minutes)
  ),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  published_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_pipeline_automation_fixed_user_chk CHECK (
    assignee_strategy <> 'fixed_user' OR assignee_user_id IS NOT NULL
  ),
  UNIQUE (logical_id, version)
);

CREATE UNIQUE INDEX crm_pipeline_automation_one_editable_version_idx
  ON public.crm_pipeline_automation_rules(logical_id)
  WHERE status IN ('draft','active','paused');
CREATE INDEX crm_pipeline_automation_stage_active_idx
  ON public.crm_pipeline_automation_rules(stage_id, status)
  WHERE status = 'active';

CREATE TABLE public.crm_pipeline_automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.crm_pipeline_automation_rules(id) ON DELETE RESTRICT,
  logical_id uuid NOT NULL,
  rule_version integer NOT NULL,
  deal_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  event_key text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (logical_id, rule_version, deal_id, event_key)
);

CREATE INDEX crm_pipeline_automation_jobs_ready_idx
  ON public.crm_pipeline_automation_jobs(status, available_at, created_at)
  WHERE status IN ('pending','failed');

ALTER TABLE public.crm_pipeline_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_automation_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.crm_pipeline_automation_rules TO authenticated;
GRANT SELECT ON public.crm_pipeline_automation_jobs TO authenticated;
GRANT ALL ON public.crm_pipeline_automation_rules, public.crm_pipeline_automation_jobs TO service_role;

CREATE POLICY crm_pipeline_automation_rules_staff_read
  ON public.crm_pipeline_automation_rules FOR SELECT TO authenticated
  USING (
    public.has_role_v2((select auth.uid()), 'employee')
    OR public.has_role_v2((select auth.uid()), 'admin')
    OR public.has_role_v2((select auth.uid()), 'super_admin')
  );

CREATE POLICY crm_pipeline_automation_rules_admin_insert
  ON public.crm_pipeline_automation_rules FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2((select auth.uid()), 'admin')
    OR public.has_role_v2((select auth.uid()), 'super_admin')
  );

CREATE POLICY crm_pipeline_automation_rules_admin_update
  ON public.crm_pipeline_automation_rules FOR UPDATE TO authenticated
  USING (
    public.has_role_v2((select auth.uid()), 'admin')
    OR public.has_role_v2((select auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2((select auth.uid()), 'admin')
    OR public.has_role_v2((select auth.uid()), 'super_admin')
  );

CREATE POLICY crm_pipeline_automation_jobs_staff_read
  ON public.crm_pipeline_automation_jobs FOR SELECT TO authenticated
  USING (
    public.has_role_v2((select auth.uid()), 'employee')
    OR public.has_role_v2((select auth.uid()), 'admin')
    OR public.has_role_v2((select auth.uid()), 'super_admin')
  );

CREATE TRIGGER update_crm_pipeline_automation_rules_updated_at
  BEFORE UPDATE ON public.crm_pipeline_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_crm_pipeline_automation_jobs_updated_at
  BEFORE UPDATE ON public.crm_pipeline_automation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
      NEW.reminder_offset_minutes, NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.conditions
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

CREATE TRIGGER trg_crm_pipeline_automation_validate_rule
  BEFORE INSERT OR UPDATE ON public.crm_pipeline_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_validate_rule();

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
    ':', coalesce(OLD.pipeline_stage_id::text, 'none'),
    ':', NEW.pipeline_stage_id::text
  );

  INSERT INTO public.crm_pipeline_automation_jobs(
    rule_id, logical_id, rule_version, deal_id, event_key, event_payload
  )
  SELECT
    r.id, r.logical_id, r.version, NEW.id, _event_key,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'old_stage_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.pipeline_stage_id ELSE NULL END,
      'new_stage_id', NEW.pipeline_stage_id,
      'occurred_at', now()
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_stage_entry() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_crm_pipeline_automation_stage_entry
  AFTER INSERT OR UPDATE OF pipeline_id, pipeline_stage_id ON public.orders_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_enqueue_stage_entry();

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_claim_jobs(
  _worker_id text,
  _limit integer DEFAULT 25
)
RETURNS SETOF public.crm_pipeline_automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM public.crm_pipeline_automation_jobs j
    WHERE j.status IN ('pending','failed')
      AND j.available_at <= now()
      AND j.attempt_count < 5
    ORDER BY j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(_limit, 1), 100)
  )
  UPDATE public.crm_pipeline_automation_jobs j
  SET status = 'running',
      locked_at = now(),
      locked_by = _worker_id,
      attempt_count = j.attempt_count + 1,
      last_error = NULL
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_complete_job(
  _job_id uuid,
  _succeeded boolean,
  _result jsonb DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.crm_pipeline_automation_jobs
  SET status = CASE
        WHEN _succeeded THEN 'succeeded'
        WHEN attempt_count >= 5 THEN 'dead'
        ELSE 'failed'
      END,
      result = _result,
      last_error = CASE WHEN _succeeded THEN NULL ELSE left(coalesce(_error, 'unknown_error'), 2000) END,
      available_at = CASE
        WHEN _succeeded OR attempt_count >= 5 THEN available_at
        ELSE now() + make_interval(secs => least(3600, 30 * power(2, attempt_count - 1)::integer))
      END,
      finished_at = CASE WHEN _succeeded OR attempt_count >= 5 THEN now() ELSE NULL END,
      locked_at = NULL,
      locked_by = NULL
  WHERE id = _job_id AND status = 'running';
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_claim_jobs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_pipeline_automation_complete_job(uuid, boolean, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_claim_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_complete_job(uuid, boolean, jsonb, text) TO service_role;

-- The canonical task writer was granted to service_role historically, but its
-- helper rejected service calls because auth.uid() is null for that role.
-- Preserve the staff gate for users and make the existing service grant real.
CREATE OR REPLACE FUNCTION public._crm_tasks_assert_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := (select auth.uid());
  _role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF _role = 'service_role' THEN
    RETURN;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role_v2(_uid, 'employee')
    OR public.has_role_v2(_uid, 'admin')
    OR public.has_role_v2(_uid, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_tasks_assert_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_tasks_assert_staff() TO authenticated, service_role;

INSERT INTO public.app_settings(key, value)
VALUES ('feature_crm_pipeline_automation_v1', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
