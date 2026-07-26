-- Companies Phase 8D: read-only unified communications feed.
-- Reuses contact_feed_list for linked profiles and adds company-owned activity
-- and tasks without changing any message/call/contact schemas.

CREATE OR REPLACE FUNCTION public.company_feed_list(
  _company_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := GREATEST(1, LEAST(COALESCE(_limit, 200) + GREATEST(COALESCE(_offset, 0), 0), 500));
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher') OR has_role_v2(v_uid, 'support')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH contact_items AS (
    SELECT item || jsonb_build_object('source', 'contact') AS item
      FROM public.company_contacts cc
      CROSS JOIN LATERAL jsonb_array_elements(
        public.contact_feed_list(cc.profile_id, _types, _search, v_limit, 0)
      ) item
     WHERE cc.company_id = _company_id
       AND cc.profile_id IS NOT NULL
  ),
  company_tasks AS (
    SELECT jsonb_build_object(
      'id', t.id::text,
      'kind', 'task',
      'at', COALESCE(t.due_at, t.created_at),
      'title', t.title,
      'body', t.description,
      'meta', jsonb_build_object(
        'public_id', t.public_id, 'status', t.status, 'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id, 'closed_at', t.closed_at,
        'task_type_id', t.task_type_id
      ),
      'author', NULL,
      'source', 'company'
    ) AS item
      FROM public.crm_tasks t
     WHERE t.company_id = _company_id
       AND NOT EXISTS (
         SELECT 1 FROM public.company_contacts cc
          WHERE cc.company_id = _company_id
            AND cc.profile_id IS NOT NULL
            AND cc.profile_id = t.contact_id
       )
       AND (_types IS NULL OR 'task' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = ''
            OR lower(coalesce(t.title, '')) LIKE '%' || lower(btrim(_search)) || '%'
            OR lower(coalesce(t.description, '')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_events AS (
    SELECT jsonb_build_object(
      'id', a.id::text,
      'kind', 'event',
      'at', a.created_at,
      'title', COALESCE(a.title_snapshot, a.activity_type),
      'body', a.text_snapshot,
      'meta', jsonb_build_object(
        'activity_type', a.activity_type,
        'source_entity_type', a.source_entity_type,
        'source_entity_id', a.source_entity_id,
        'live_event_id', a.live_event_id
      ),
      'author', a.author_snapshot,
      'source', 'company'
    ) AS item
      FROM public.crm_activity_log a
     WHERE a.source_entity_type = 'company'
       AND a.source_entity_id = _company_id
       AND (_types IS NULL OR 'event' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = ''
            OR lower(coalesce(a.title_snapshot, '')) LIKE '%' || lower(btrim(_search)) || '%'
            OR lower(coalesce(a.text_snapshot, '')) LIKE '%' || lower(btrim(_search)) || '%'
            OR lower(coalesce(a.activity_type, '')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  all_items AS (
    SELECT item FROM contact_items
    UNION ALL SELECT item FROM company_tasks
    UNION ALL SELECT item FROM company_events
  ),
  ordered AS (
    SELECT item
      FROM all_items
     ORDER BY (item->>'at')::timestamptz DESC NULLS LAST, item->>'id'
     LIMIT v_limit OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'at')::timestamptz DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
    FROM ordered;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_feed_list(uuid, text[], text, int, int)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.company_feed_list(uuid, text[], text, int, int)
  TO authenticated;
