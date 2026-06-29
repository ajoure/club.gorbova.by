
-- ============================================================
-- PATCH C — bulk RPC for CRM tasks
-- crm_task_bulk_status, crm_task_bulk_update
-- SECURITY DEFINER, staff gate, audit to crm_activity_log
-- ============================================================

-- bulk_status -------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_task_bulk_status(
  _task_ids uuid[],
  _status text,
  _result_comment text DEFAULT NULL,
  _request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_super boolean;
  _row record;
  _updated int := 0;
  _skipped jsonb := '[]'::jsonb;
  _req text := COALESCE(nullif(trim(_request_id), ''), gen_random_uuid()::text);
  _comment text := nullif(trim(_result_comment), '');
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  IF _task_ids IS NULL OR array_length(_task_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_task_ids' USING ERRCODE = '22023';
  END IF;
  IF _status NOT IN ('open','in_progress','done','canceled') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF _status IN ('done','canceled') AND _comment IS NULL THEN
    RAISE EXCEPTION 'result_comment_required' USING ERRCODE = '22023';
  END IF;

  _is_super := public.has_role_v2(_uid, 'super_admin');

  FOR _row IN
    SELECT id, status FROM public.crm_tasks
     WHERE id = ANY(_task_ids)
     FOR UPDATE
  LOOP
    IF _row.status IN ('done','canceled')
       AND _status NOT IN ('done','canceled')
       AND NOT _is_super THEN
      _skipped := _skipped || jsonb_build_object('id', _row.id, 'reason', 'reopen_forbidden');
      CONTINUE;
    END IF;

    UPDATE public.crm_tasks
       SET status = _status,
           result_comment = COALESCE(_comment, result_comment),
           closed_at = CASE WHEN _status IN ('done','canceled') THEN now() ELSE NULL END,
           closed_by = CASE WHEN _status IN ('done','canceled') THEN _uid ELSE NULL END,
           updated_by = _uid
     WHERE id = _row.id;

    INSERT INTO public.crm_activity_log
      (user_id, activity_type, source_entity_id, source_entity_type,
       title_snapshot, text_snapshot, idempotency_key, metadata)
    VALUES
      (_uid, 'task_bulk_status', _row.id, 'crm_task',
       'Bulk status: ' || _status,
       _comment,
       'bulk_status:' || _req || ':' || _row.id::text,
       jsonb_build_object(
         'status_from', _row.status,
         'status_to', _status,
         'request_id', _req
       ))
    ON CONFLICT (idempotency_key) DO NOTHING;

    _updated := _updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', _updated,
    'total', array_length(_task_ids, 1),
    'skipped', _skipped,
    'request_id', _req
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_bulk_status(uuid[], text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_bulk_status(uuid[], text, text, text)
  TO authenticated, service_role;

-- bulk_update -------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_task_bulk_update(
  _task_ids uuid[],
  _patch jsonb,
  _request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed text[] := ARRAY[
    'task_type_id','assignee_user_id','due_at','remind_at',
    'deal_id','contact_id','description'
  ];
  _key text;
  _patch_keys text[] := ARRAY[]::text[];
  _req text := COALESCE(nullif(trim(_request_id), ''), gen_random_uuid()::text);
  _has_type   boolean := _patch ? 'task_type_id';
  _has_assign boolean := _patch ? 'assignee_user_id';
  _has_due    boolean := _patch ? 'due_at';
  _has_remind boolean := _patch ? 'remind_at';
  _has_deal   boolean := _patch ? 'deal_id';
  _has_contact boolean := _patch ? 'contact_id';
  _has_desc   boolean := _patch ? 'description';
  _val_type uuid;
  _val_assign uuid;
  _val_due timestamptz;
  _val_remind timestamptz;
  _val_deal uuid;
  _val_contact uuid;
  _val_desc text;
  _updated int := 0;
  _id uuid;
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  IF _task_ids IS NULL OR array_length(_task_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_task_ids' USING ERRCODE = '22023';
  END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' OR _patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty_patch' USING ERRCODE = '22023';
  END IF;

  FOR _key IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT (_key = ANY(_allowed)) THEN
      RAISE EXCEPTION 'forbidden_field:%', _key USING ERRCODE = '42501';
    END IF;
    _patch_keys := _patch_keys || _key;
  END LOOP;

  IF _has_type   THEN _val_type   := nullif(_patch->>'task_type_id','')::uuid;   END IF;
  IF _has_assign THEN _val_assign := nullif(_patch->>'assignee_user_id','')::uuid; END IF;
  IF _has_due    THEN _val_due    := nullif(_patch->>'due_at','')::timestamptz;    END IF;
  IF _has_remind THEN _val_remind := nullif(_patch->>'remind_at','')::timestamptz; END IF;
  IF _has_deal   THEN _val_deal   := nullif(_patch->>'deal_id','')::uuid;          END IF;
  IF _has_contact THEN _val_contact := nullif(_patch->>'contact_id','')::uuid;     END IF;
  IF _has_desc   THEN _val_desc   := _patch->>'description';                       END IF;

  -- type must exist if provided
  IF _has_type AND _val_type IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_task_types WHERE id = _val_type) THEN
    RAISE EXCEPTION 'task_type_not_found' USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_tasks SET
    task_type_id     = CASE WHEN _has_type   THEN COALESCE(_val_type, task_type_id) ELSE task_type_id END,
    assignee_user_id = CASE WHEN _has_assign THEN _val_assign ELSE assignee_user_id END,
    due_at           = CASE WHEN _has_due    THEN _val_due    ELSE due_at END,
    remind_at        = CASE WHEN _has_remind THEN _val_remind ELSE remind_at END,
    deal_id          = CASE WHEN _has_deal   THEN _val_deal   ELSE deal_id END,
    contact_id       = CASE WHEN _has_contact THEN _val_contact ELSE contact_id END,
    description      = CASE WHEN _has_desc   THEN _val_desc   ELSE description END,
    updated_by       = _uid
  WHERE id = ANY(_task_ids);

  GET DIAGNOSTICS _updated = ROW_COUNT;

  FOREACH _id IN ARRAY _task_ids LOOP
    INSERT INTO public.crm_activity_log
      (user_id, activity_type, source_entity_id, source_entity_type,
       title_snapshot, idempotency_key, metadata)
    VALUES
      (_uid, 'task_bulk_update', _id, 'crm_task',
       'Bulk update: ' || array_to_string(_patch_keys, ','),
       'bulk_update:' || _req || ':' || _id::text,
       jsonb_build_object('patch_keys', _patch_keys, 'request_id', _req))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', _updated,
    'total', array_length(_task_ids, 1),
    'request_id', _req,
    'patch_keys', _patch_keys
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_task_bulk_update(uuid[], jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_task_bulk_update(uuid[], jsonb, text)
  TO authenticated, service_role;
