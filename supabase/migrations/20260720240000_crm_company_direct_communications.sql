-- Companies parity: allow direct company communications without pretending that
-- a company is a contact. Existing contact/deal rows remain unchanged.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS company_id uuid;

CREATE INDEX IF NOT EXISTS calls_company_started_idx
  ON public.calls (company_id, started_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_company_created_idx
  ON public.sms_messages (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_logs_company_created_idx
  ON public.email_logs (company_id, created_at DESC) WHERE company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.company_feed_list(
  _company_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := GREATEST(1, LEAST(COALESCE(_limit, 200) + GREATEST(COALESCE(_offset, 0), 0), 500));
  v_like text := CASE WHEN _search IS NULL OR btrim(_search) = '' THEN NULL ELSE '%' || lower(btrim(_search)) || '%' END;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT (has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
      OR has_role_v2(v_uid, 'menedzher') OR has_role_v2(v_uid, 'support')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH actor_names AS (
    SELECT p.user_id, COALESCE(NULLIF(p.full_name, ''), p.email) AS name
      FROM public.profiles p WHERE p.user_id IS NOT NULL
  ),
  contact_items AS (
    SELECT item || jsonb_build_object('source', 'contact') AS item
      FROM public.company_contacts cc
      CROSS JOIN LATERAL jsonb_array_elements(public.contact_feed_list(cc.profile_id, _types, _search, v_limit, 0)) item
     WHERE cc.company_id = _company_id AND cc.profile_id IS NOT NULL
  ),
  company_calls AS (
    SELECT jsonb_build_object(
      'id', c.id::text, 'kind', 'call', 'at', COALESCE(c.started_at, c.created_at),
      'title', CASE c.direction::text WHEN 'inbound' THEN 'Входящий звонок' WHEN 'outbound' THEN 'Исходящий звонок' ELSE 'Звонок' END,
      'body', COALESCE(c.summary, ''),
      'meta', jsonb_build_object('public_id', c.public_id, 'phone', COALESCE(c.phone_from_e164, c.phone_to_e164, c.phone_from_raw, c.phone_to_raw),
        'phone_from', COALESCE(c.phone_from_e164, c.phone_from_raw), 'phone_to', COALESCE(c.phone_to_e164, c.phone_to_raw),
        'status', c.status::text, 'direction', c.direction::text, 'duration', c.duration_seconds,
        'recording_url', c.recording_url, 'transcript', c.transcript, 'summary', c.summary),
      'author', (SELECT name FROM actor_names WHERE user_id = COALESCE(c.manager_user_id, c.created_by) LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.calls c
     WHERE c.company_id = _company_id
       AND (_types IS NULL OR 'call' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(c.transcript, '')) LIKE v_like OR lower(coalesce(c.summary, '')) LIKE v_like
         OR lower(coalesce(c.phone_from_e164, '')) LIKE v_like OR lower(coalesce(c.phone_to_e164, '')) LIKE v_like)
  ),
  company_sms AS (
    SELECT jsonb_build_object(
      'id', s.id::text, 'kind', 'sms', 'at', s.created_at,
      'title', CASE WHEN coalesce(s.status, '') = 'sent' THEN 'SMS отправлено' ELSE 'SMS: ' || coalesce(s.status, 'без статуса') END,
      'body', s.text,
      'meta', jsonb_build_object('phone', s.phone_e164, 'status', s.status, 'provider', s.provider, 'sender', s.sender, 'external_id', s.external_id),
      'author', (SELECT name FROM actor_names WHERE user_id = s.initiator_user_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.sms_messages s
     WHERE s.company_id = _company_id
       AND (_types IS NULL OR 'sms' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(s.text, '')) LIKE v_like OR lower(coalesce(s.phone_e164, '')) LIKE v_like)
  ),
  company_emails AS (
    SELECT jsonb_build_object(
      'id', e.id::text, 'kind', 'email', 'at', e.created_at,
      'title', CASE e.direction WHEN 'outgoing' THEN 'Письмо отправлено' WHEN 'incoming' THEN 'Письмо получено' ELSE 'Письмо' END || COALESCE(': ' || NULLIF(e.subject, ''), ''),
      'body', COALESCE(e.body_text, regexp_replace(coalesce(e.body_html, ''), '<[^>]+>', ' ', 'g')),
      'meta', jsonb_build_object('from_email', e.from_email, 'to_email', e.to_email, 'direction', e.direction, 'status', e.status, 'subject', e.subject),
      'author', NULL, 'source', 'company'
    ) AS item
      FROM public.email_logs e
     WHERE e.company_id = _company_id
       AND (_types IS NULL OR 'email' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(e.subject, '')) LIKE v_like OR lower(coalesce(e.body_text, '')) LIKE v_like
         OR lower(coalesce(e.body_html, '')) LIKE v_like OR lower(coalesce(e.to_email, '')) LIKE v_like)
  ),
  company_notes AS (
    SELECT jsonb_build_object(
      'id', n.id::text, 'kind', 'note', 'at', n.created_at, 'title', 'Заметка', 'body', n.body,
      'meta', jsonb_build_object('author_id', n.author_id, 'source', n.source, 'source_key', n.source_key, 'metadata', n.metadata,
        'can_delete', (n.author_id = v_uid OR has_role_v2(v_uid, 'admin') OR has_role_v2(v_uid, 'super_admin'))),
      'author', (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = n.author_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.company_notes n
     WHERE n.company_id = _company_id
       AND (_types IS NULL OR 'note' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(n.body, '')) LIKE v_like)
  ),
  company_files AS (
    SELECT jsonb_build_object(
      'id', f.id::text, 'kind', CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm') THEN 'voice_note' ELSE 'file' END,
      'at', f.created_at, 'title', f.name, 'body', NULL,
      'meta', jsonb_build_object('name', f.name, 'url', f.url, 'storage_path', f.storage_path, 'mime_type', f.mime_type,
        'size_bytes', f.size_bytes, 'uploader_id', f.uploader_id, 'can_delete', (f.uploader_id = v_uid OR has_role_v2(v_uid, 'admin') OR has_role_v2(v_uid, 'super_admin')),
        'transcribe_status', f.meta->>'transcribe_status', 'transcript', f.meta->>'transcript', 'summary', f.meta->>'summary'),
      'author', (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = f.uploader_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.company_files f
     WHERE f.company_id = _company_id
       AND (_types IS NULL OR 'file' = ANY(_types) OR 'voice_note' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(f.name, '')) LIKE v_like)
  ),
  company_tasks AS (
    SELECT jsonb_build_object('id', t.id::text, 'kind', 'task', 'at', COALESCE(t.due_at, t.created_at), 'title', t.title, 'body', t.description,
      'meta', jsonb_build_object('public_id', t.public_id, 'status', t.status, 'due_at', t.due_at, 'assignee_user_id', t.assignee_user_id, 'closed_at', t.closed_at, 'task_type_id', t.task_type_id),
      'author', NULL, 'source', 'company') AS item
      FROM public.crm_tasks t
     WHERE t.company_id = _company_id
       AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = _company_id AND cc.profile_id IS NOT NULL AND cc.profile_id = t.contact_id)
       AND (_types IS NULL OR 'task' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(t.title, '')) LIKE v_like OR lower(coalesce(t.description, '')) LIKE v_like)
  ),
  company_events AS (
    SELECT jsonb_build_object('id', a.id::text, 'kind', 'event', 'at', a.created_at, 'title', COALESCE(a.title_snapshot, a.activity_type), 'body', a.text_snapshot,
      'meta', jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type, 'source_entity_id', a.source_entity_id, 'live_event_id', a.live_event_id),
      'author', a.author_snapshot, 'source', 'company') AS item
      FROM public.crm_activity_log a
     WHERE a.source_entity_type = 'company' AND a.source_entity_id = _company_id
       AND (_types IS NULL OR 'event' = ANY(_types))
       AND (v_like IS NULL OR lower(coalesce(a.title_snapshot, '')) LIKE v_like OR lower(coalesce(a.text_snapshot, '')) LIKE v_like OR lower(coalesce(a.activity_type, '')) LIKE v_like)
  ),
  all_items AS (
    SELECT item FROM contact_items UNION ALL SELECT item FROM company_calls UNION ALL SELECT item FROM company_sms
    UNION ALL SELECT item FROM company_emails UNION ALL SELECT item FROM company_notes UNION ALL SELECT item FROM company_files
    UNION ALL SELECT item FROM company_tasks UNION ALL SELECT item FROM company_events
  ),
  ordered AS (
    SELECT item FROM all_items
    ORDER BY (item->>'at')::timestamptz DESC NULLS LAST, item->>'id'
    LIMIT v_limit OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'at')::timestamptz DESC NULLS LAST), '[]'::jsonb)
    INTO v_result FROM ordered;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_feed_list(uuid, text[], text, int, int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.company_feed_list(uuid, text[], text, int, int) TO authenticated;
