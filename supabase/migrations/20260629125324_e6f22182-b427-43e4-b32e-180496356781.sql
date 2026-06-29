-- ============================================================
-- CRM TASKS RPC layer (Step 3)
-- All functions: SECURITY DEFINER, role gate via has_role_v2
-- ============================================================

-- ---------- internal helper: role gate ----------
CREATE OR REPLACE FUNCTION public._crm_tasks_assert_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
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

REVOKE ALL ON FUNCTION public._crm_tasks_assert_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._crm_tasks_assert_staff() TO authenticated, service_role;

-- ============================================================
-- crm_task_create(payload jsonb) RETURNS uuid
-- ============================================================
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
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  _title := nullif(trim(payload->>'title'), '');
  IF _title IS NULL THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = '22023';
  END IF;

  -- resolve task_type: by id (uuid) or by key
  IF payload ? 'task_type_id' AND nullif(payload->>'task_type_id','') IS NOT NULL THEN
    _type_id := (payload->>'task_type_id')::uuid;
    SELECT * INTO _type_row FROM public.crm_task_types WHERE id = _type_id;
  ELSIF payload ? 'task_type' AND nullif(payload->>'task_type','') IS NOT NULL THEN
    _type_key := payload->>'task_type';
    SELECT * INTO _type_row FROM public.crm_task_types WHERE key = _type_key AND is_active = true;
  ELSE
    RAISE EXCEPTION 'task_type_required' USING ERRCODE = '22023';
  END IF;

  IF _type_row.id IS NULL THEN
    RAISE EXCEPTION 'task_type_not_found' USING ERRCODE = '22023';
  END IF;

  -- due_at: explicit or computed from type default
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

  _source := coalesce(nullif(payload->>'source',''), 'manual');
  IF _source NOT IN ('manual','auto','system') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.crm_tasks (
    task_type_id, title, description,
    contact_id, deal_id, order_id,
    pipeline_id, pipeline_stage_id,
    offer_id, product_id, tariff_id,
    assignee_user_id, due_at, remind_at,
    status, source, automation_rule_id,
    created_by, updated_by, meta
  ) VALUES (
    _type_row.id,
    _title,
    nullif(payload->>'description',''),
    nullif(payload->>'contact_id','')::uuid,
    nullif(payload->>'deal_id','')::uuid,
    nullif(payload->>'order_id','')::uuid,
    nullif(payload->>'pipeline_id','')::uuid,
    nullif(payload->>'pipeline_stage_id','')::uuid,
    nullif(payload->>'offer_id','')::uuid,
    nullif(payload->>'product_id','')::uuid,
    nullif(payload->>'tariff_id','')::uuid,
    nullif(payload->>'assignee_user_id','')::uuid,
    _due_at,
    _remind_at,
    coalesce(nullif(payload->>'status',''), 'open'),
    _source,
    nullif(payload->>'automation_rule_id','')::uuid,
    _uid,
    _uid,
    coalesce(payload->'meta', '{}'::jsonb)
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_create(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_create(jsonb) TO authenticated, service_role;

-- ============================================================
-- crm_task_update_status(_task_id, _status, _result_comment)
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_task_update_status(
  _task_id uuid,
  _status text,
  _result_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cur public.crm_tasks%ROWTYPE;
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  IF _status NOT IN ('open','in_progress','done','canceled') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _cur FROM public.crm_tasks WHERE id = _task_id FOR UPDATE;
  IF _cur.id IS NULL THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = '22023';
  END IF;

  -- reopening of closed tasks restricted to super_admin
  IF _cur.status IN ('done','canceled')
     AND _status NOT IN ('done','canceled')
     AND NOT public.has_role_v2(_uid, 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_reopen_closed_task' USING ERRCODE = '42501';
  END IF;

  UPDATE public.crm_tasks
     SET status = _status,
         result_comment = COALESCE(_result_comment, result_comment),
         closed_at = CASE WHEN _status IN ('done','canceled') THEN now() ELSE NULL END,
         closed_by = CASE WHEN _status IN ('done','canceled') THEN _uid ELSE NULL END,
         updated_by = _uid
   WHERE id = _task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_update_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_update_status(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- crm_task_reassign(_task_id, _assignee)
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_task_reassign(
  _task_id uuid,
  _assignee uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  UPDATE public.crm_tasks
     SET assignee_user_id = _assignee,
         updated_by = _uid
   WHERE id = _task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_reassign(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_reassign(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- crm_task_apply_automation(_offer_id, _deal_id, _context) RETURNS uuid[]
-- Idempotent by (automation_rule_id, deal_id) — relies on
-- crm_tasks_automation_uniq partial unique index.
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_task_apply_automation(
  _offer_id uuid,
  _deal_id uuid,
  _context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rule public.crm_task_automation_rules%ROWTYPE;
  _deal public.orders_v2%ROWTYPE;
  _type public.crm_task_types%ROWTYPE;
  _assignee uuid;
  _due timestamptz;
  _remind timestamptz;
  _title text;
  _desc text;
  _new_id uuid;
  _created uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _offer_id IS NULL OR _deal_id IS NULL THEN
    RAISE EXCEPTION 'offer_and_deal_required' USING ERRCODE = '22023';
  END IF;

  -- callable by staff OR service_role (no auth.uid())
  IF auth.uid() IS NOT NULL THEN
    PERFORM public._crm_tasks_assert_staff();
  END IF;

  SELECT * INTO _deal FROM public.orders_v2 WHERE id = _deal_id;
  IF _deal.id IS NULL THEN
    RAISE EXCEPTION 'deal_not_found' USING ERRCODE = '22023';
  END IF;

  FOR _rule IN
    SELECT *
      FROM public.crm_task_automation_rules
     WHERE offer_id = _offer_id
       AND is_active = true
  LOOP
    SELECT * INTO _type FROM public.crm_task_types WHERE id = _rule.task_type_id;
    IF _type.id IS NULL OR _type.is_active = false THEN
      CONTINUE;
    END IF;

    -- resolve assignee
    IF _rule.assignee_strategy = 'fixed_user' THEN
      _assignee := _rule.assignee_user_id;
    ELSIF _rule.assignee_strategy = 'deal_owner' THEN
      -- prefer orders_v2.assigned_to if exists, else profile owner
      BEGIN
        EXECUTE 'SELECT assigned_to FROM public.orders_v2 WHERE id = $1'
          INTO _assignee USING _deal_id;
      EXCEPTION WHEN undefined_column THEN
        _assignee := NULL;
      END;
      IF _assignee IS NULL THEN
        _assignee := _rule.assignee_user_id; -- fallback
      END IF;
    ELSE
      -- round_robin: simple fallback to assignee_user_id; real RR in worker layer
      _assignee := _rule.assignee_user_id;
    END IF;

    _due := now() + make_interval(mins => _rule.due_offset_minutes);
    IF _rule.reminder_offset_minutes IS NOT NULL THEN
      _remind := _due - make_interval(mins => _rule.reminder_offset_minutes);
    ELSE
      _remind := NULL;
    END IF;

    _title := COALESCE(_rule.title_template, _type.label);
    _desc  := _rule.description_template;

    BEGIN
      INSERT INTO public.crm_tasks (
        task_type_id, title, description,
        contact_id, deal_id, offer_id,
        assignee_user_id, due_at, remind_at,
        status, source, automation_rule_id,
        created_by, updated_by, meta
      ) VALUES (
        _type.id, _title, _desc,
        _deal.profile_id, _deal.id, _offer_id,
        _assignee, _due, _remind,
        'open', 'auto', _rule.id,
        NULL, NULL,
        COALESCE(_context, '{}'::jsonb)
      )
      RETURNING id INTO _new_id;

      _created := array_append(_created, _new_id);
    EXCEPTION WHEN unique_violation THEN
      -- idempotent: rule+deal already produced a task
      CONTINUE;
    END;
  END LOOP;

  RETURN _created;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_apply_automation(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_apply_automation(uuid, uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- crm_task_list(_filters jsonb) RETURNS SETOF crm_tasks
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_task_list(_filters jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.crm_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _assignee uuid;
  _statuses text[];
  _type_ids uuid[];
  _deal_id uuid;
  _contact_id uuid;
  _due_from timestamptz;
  _due_to timestamptz;
  _bucket text;
  _search text;
  _limit int;
  _offset int;
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  _assignee  := nullif(_filters->>'assignee_user_id','')::uuid;
  _statuses  := CASE WHEN jsonb_typeof(_filters->'status') = 'array'
                     THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'status'))
                     ELSE NULL END;
  _type_ids  := CASE WHEN jsonb_typeof(_filters->'task_type_id') = 'array'
                     THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'task_type_id'))::uuid)
                     ELSE NULL END;
  _deal_id    := nullif(_filters->>'deal_id','')::uuid;
  _contact_id := nullif(_filters->>'contact_id','')::uuid;
  _due_from   := nullif(_filters->>'due_from','')::timestamptz;
  _due_to     := nullif(_filters->>'due_to','')::timestamptz;
  _bucket     := nullif(_filters->>'bucket','');
  _search     := nullif(trim(_filters->>'search'),'');
  _limit      := COALESCE(nullif(_filters->>'limit','')::int, 200);
  _offset     := COALESCE(nullif(_filters->>'offset','')::int, 0);

  RETURN QUERY
  SELECT t.*
    FROM public.crm_tasks t
   WHERE (_assignee  IS NULL OR t.assignee_user_id = _assignee)
     AND (_statuses  IS NULL OR t.status = ANY(_statuses))
     AND (_type_ids  IS NULL OR t.task_type_id = ANY(_type_ids))
     AND (_deal_id    IS NULL OR t.deal_id = _deal_id)
     AND (_contact_id IS NULL OR t.contact_id = _contact_id)
     AND (_due_from   IS NULL OR t.due_at >= _due_from)
     AND (_due_to     IS NULL OR t.due_at <= _due_to)
     AND (
       _bucket IS NULL
       OR (_bucket = 'overdue' AND t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at < now())
       OR (_bucket = 'today'   AND t.status IN ('open','in_progress') AND t.due_at::date = (now() AT TIME ZONE 'Europe/Minsk')::date)
       OR (_bucket = 'tomorrow' AND t.status IN ('open','in_progress') AND t.due_at::date = ((now() AT TIME ZONE 'Europe/Minsk')::date + 1))
       OR (_bucket = 'week'    AND t.status IN ('open','in_progress') AND t.due_at >= now() AND t.due_at < now() + interval '7 days')
       OR (_bucket = 'later'   AND t.status IN ('open','in_progress') AND t.due_at >= now() + interval '7 days')
       OR (_bucket = 'no_due'  AND t.status IN ('open','in_progress') AND t.due_at IS NULL)
       OR (_bucket = 'closed'  AND t.status IN ('done','canceled'))
     )
     AND (
       _search IS NULL
       OR t.title ILIKE '%'||_search||'%'
       OR COALESCE(t.description,'') ILIKE '%'||_search||'%'
       OR COALESCE(t.public_id,'') ILIKE '%'||_search||'%'
     )
   ORDER BY
     CASE WHEN t.status IN ('open','in_progress') THEN 0 ELSE 1 END,
     t.due_at NULLS LAST,
     t.created_at DESC
   LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_list(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_list(jsonb) TO authenticated, service_role;
