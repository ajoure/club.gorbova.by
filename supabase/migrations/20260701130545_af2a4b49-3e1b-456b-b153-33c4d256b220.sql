
ALTER TABLE public.contact_files
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_contact_files_meta_transcribe_status
  ON public.contact_files ((meta->>'transcribe_status'));

CREATE OR REPLACE FUNCTION public.contact_feed_list(
  _contact_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _like text := CASE WHEN _search IS NULL OR btrim(_search) = '' THEN NULL ELSE '%' || lower(btrim(_search)) || '%' END;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT (
    public.has_role_v2(_uid, 'employee')
    OR public.has_role_v2(_uid, 'admin')
    OR public.has_role_v2(_uid, 'super_admin')
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH calls_src AS (
    SELECT c.id, 'call'::text AS kind, c.started_at AS at,
      c.direction::text AS title,
      COALESCE(c.summary, '') AS body,
      jsonb_build_object(
        'public_id', c.public_id,
        'phone', c.phone,
        'status', c.status::text,
        'direction', c.direction::text,
        'duration', c.duration_seconds,
        'recording_url', c.recording_url,
        'transcript', c.transcript,
        'summary', c.summary
      ) AS meta, NULL::text AS author
    FROM public.calls c
    WHERE c.contact_id = _contact_id
      AND (_types IS NULL OR 'call' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(c.transcript,'')) LIKE _like OR lower(coalesce(c.summary,'')) LIKE _like OR lower(coalesce(c.phone,'')) LIKE _like)
  ),
  sms_src AS (
    SELECT s.id, 'sms'::text AS kind, s.created_at AS at,
      s.direction::text AS title, s.body,
      jsonb_build_object('phone', s.phone, 'status', s.status::text, 'direction', s.direction::text) AS meta,
      NULL::text AS author
    FROM public.sms_messages s
    WHERE s.contact_id = _contact_id
      AND (_types IS NULL OR 'sms' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(s.body,'')) LIKE _like OR lower(coalesce(s.phone,'')) LIKE _like)
  ),
  tg_src AS (
    SELECT m.id::text AS id, 'telegram'::text AS kind, m.created_at AS at,
      COALESCE(m.direction, 'in')::text AS title, m.text AS body,
      jsonb_build_object(
        'chat_id', m.chat_id, 'user_id', m.user_id,
        'direction', m.direction
      ) AS meta,
      NULL::text AS author
    FROM public.telegram_messages m
    WHERE m.contact_id = _contact_id
      AND (_types IS NULL OR 'telegram' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(m.text,'')) LIKE _like)
  ),
  email_src AS (
    SELECT e.id, 'email'::text AS kind, e.created_at AS at,
      e.subject AS title, COALESCE(e.body_text, e.body_html) AS body,
      jsonb_build_object(
        'from_addr', e.from_addr, 'to_addr', e.to_addr,
        'direction', e.direction, 'status', e.status
      ) AS meta, NULL::text AS author
    FROM public.email_logs e
    WHERE e.contact_id = _contact_id
      AND (_types IS NULL OR 'email' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(e.subject,'')) LIKE _like OR lower(coalesce(e.body_text,'')) LIKE _like)
  ),
  tasks AS (
    SELECT t.id, 'task'::text AS kind, t.created_at AS at,
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
    SELECT f.id,
      CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm' OR f.mime_type = 'audio/webm') THEN 'voice_note' ELSE 'file' END AS kind,
      f.created_at AS at,
      f.name AS title, NULL::text AS body,
      jsonb_build_object(
        'name', f.name, 'url', f.url, 'storage_path', f.storage_path,
        'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
        'uploader_id', f.uploader_id,
        'transcript', f.meta->>'transcript',
        'summary', f.meta->>'summary',
        'transcribe_status', f.meta->>'transcribe_status',
        'transcribe_reason', f.meta->>'transcribe_reason',
        'can_delete', (f.uploader_id = _uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))
      ) AS meta,
      (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = f.uploader_id LIMIT 1) AS author
    FROM public.contact_files f
    WHERE f.contact_id = _contact_id
      AND (_types IS NULL OR 'file' = ANY(_types) OR 'voice_note' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(f.name,'')) LIKE _like OR lower(coalesce(f.meta->>'transcript','')) LIKE _like OR lower(coalesce(f.meta->>'summary','')) LIKE _like)
  ),
  deals AS (
    SELECT o.id, 'deal'::text AS kind, o.created_at AS at,
      ('Сделка ' || COALESCE(o.order_number, substr(o.id::text,1,8))) AS title,
      CASE o.status::text
        WHEN 'paid' THEN 'Оплачено'
        WHEN 'pending' THEN 'Ожидает оплаты'
        WHEN 'canceled' THEN 'Отменена'
        WHEN 'refunded' THEN 'Возврат'
        WHEN 'partial' THEN 'Частичная оплата'
        WHEN 'failed' THEN 'Ошибка оплаты'
        WHEN 'draft' THEN 'Черновик'
        WHEN 'needs_mapping' THEN 'Требует сопоставления'
        ELSE o.status::text
      END AS body,
      jsonb_build_object(
        'order_number', o.order_number, 'status', o.status::text,
        'final_price', o.final_price, 'currency', o.currency,
        'product_id', o.product_id, 'tariff_id', o.tariff_id
      ) AS meta, NULL::text AS author
    FROM public.orders_v2 o
    JOIN public.profiles p ON p.user_id = o.user_id
    WHERE p.id = _contact_id
      AND (_types IS NULL OR 'deal' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(o.order_number,'')) LIKE _like)
  ),
  events AS (
    SELECT a.id::text AS id, 'event'::text AS kind, a.created_at AS at,
      a.action AS title, a.description AS body,
      jsonb_build_object('action', a.action, 'entity_type', a.entity_type) AS meta,
      NULL::text AS author
    FROM public.crm_activity_log a
    WHERE a.contact_id = _contact_id
      AND (_types IS NULL OR 'event' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.description,'')) LIKE _like OR lower(coalesce(a.action,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls_src
    UNION ALL SELECT * FROM sms_src
    UNION ALL SELECT * FROM tg_src
    UNION ALL SELECT * FROM email_src
    UNION ALL SELECT * FROM tasks
    UNION ALL SELECT * FROM notes
    UNION ALL SELECT * FROM files
    UNION ALL SELECT * FROM deals
    UNION ALL SELECT * FROM events
  )
  SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.at DESC NULLS LAST) FILTER (WHERE e.at IS NOT NULL), '[]'::jsonb)
  INTO _result
  FROM (
    SELECT * FROM all_events
    ORDER BY at DESC NULLS LAST
    LIMIT _limit OFFSET _offset
  ) e;

  RETURN COALESCE(_result, '[]'::jsonb);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.contact_feed_list(uuid, text[], text, int, int) TO authenticated;
