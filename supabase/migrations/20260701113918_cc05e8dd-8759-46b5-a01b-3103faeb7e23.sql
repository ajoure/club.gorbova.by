
CREATE OR REPLACE FUNCTION public.contact_feed_list(
  _contact_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _q text := NULLIF(trim(coalesce(_search,'')), '');
  _like text := CASE WHEN _q IS NOT NULL THEN '%' || lower(_q) || '%' ELSE NULL END;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(_uid,'employee') OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  WITH
  calls AS (
    SELECT c.id, 'call'::text AS kind, COALESCE(c.started_at, c.created_at) AS at,
      COALESCE(c.direction::text,'call') AS title, c.summary AS body,
      jsonb_build_object(
        'public_id', c.public_id,
        'phone', COALESCE(c.phone_from_e164, c.phone_to_e164),
        'direction', c.direction::text,
        'duration', c.duration_seconds,
        'status', c.status::text,
        'recording_url', c.recording_url,
        'transcript', c.transcript
      ) AS meta, NULL::text AS author
    FROM public.calls c
    WHERE c.contact_id = _contact_id
      AND (_types IS NULL OR 'call' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(c.summary,'')) LIKE _like OR lower(coalesce(c.transcript,'')) LIKE _like)
  ),
  sms AS (
    SELECT s.id, 'sms'::text AS kind, s.created_at AS at,
      'sms'::text AS title, s.text AS body,
      jsonb_build_object('phone', s.phone_e164, 'status', s.status, 'provider', s.provider) AS meta,
      NULL::text AS author
    FROM public.sms_messages s
    WHERE s.contact_id = _contact_id
      AND (_types IS NULL OR 'sms' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(s.text,'')) LIKE _like)
  ),
  tasks AS (
    SELECT t.id, 'task'::text AS kind, COALESCE(t.due_at, t.created_at) AS at,
      t.title, t.description AS body,
      jsonb_build_object(
        'public_id', t.public_id,
        'status', t.status,
        'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id,
        'closed_at', t.closed_at,
        'task_type_id', t.task_type_id
      ) AS meta, NULL::text AS author
    FROM public.crm_tasks t
    WHERE t.contact_id = _contact_id
      AND (_types IS NULL OR 'task' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(t.title,'')) LIKE _like OR lower(coalesce(t.description,'')) LIKE _like)
  ),
  notes AS (
    SELECT n.id, 'note'::text AS kind, n.created_at AS at,
      'Заметка'::text AS title, n.body,
      jsonb_build_object(
        'author_id', n.author_id,
        'can_delete', (n.author_id = _uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))
      ) AS meta,
      (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = n.author_id LIMIT 1) AS author
    FROM public.contact_notes n
    WHERE n.contact_id = _contact_id
      AND (_types IS NULL OR 'note' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(n.body,'')) LIKE _like)
  ),
  files AS (
    SELECT f.id, 'file'::text AS kind, f.created_at AS at,
      f.name AS title, NULL::text AS body,
      jsonb_build_object(
        'name', f.name, 'url', f.url, 'storage_path', f.storage_path,
        'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
        'uploader_id', f.uploader_id,
        'can_delete', (f.uploader_id = _uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))
      ) AS meta,
      (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = f.uploader_id LIMIT 1) AS author
    FROM public.contact_files f
    WHERE f.contact_id = _contact_id
      AND (_types IS NULL OR 'file' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(f.name,'')) LIKE _like)
  ),
  events AS (
    SELECT a.id, 'event'::text AS kind, a.created_at AS at,
      COALESCE(a.title_snapshot, a.activity_type) AS title, a.text_snapshot AS body,
      jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type) AS meta,
      a.author_snapshot AS author
    FROM public.crm_activity_log a
    WHERE a.contact_id = _contact_id
      AND (_types IS NULL OR 'event' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.title_snapshot,'')) LIKE _like OR lower(coalesce(a.text_snapshot,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls
    UNION ALL SELECT * FROM sms
    UNION ALL SELECT * FROM tasks
    UNION ALL SELECT * FROM notes
    UNION ALL SELECT * FROM files
    UNION ALL SELECT * FROM events
  ),
  ordered AS (
    SELECT * FROM all_events
    ORDER BY at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(_limit, 500))
    OFFSET GREATEST(0, _offset)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'at', at, 'title', title,
    'body', body, 'meta', meta, 'author', author
  )), '[]'::jsonb) INTO _result FROM ordered;

  RETURN _result;
END; $function$;

REVOKE ALL ON FUNCTION public.contact_feed_list(uuid, text[], text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_feed_list(uuid, text[], text, int, int) TO authenticated, service_role;
