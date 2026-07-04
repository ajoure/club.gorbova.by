
CREATE OR REPLACE FUNCTION public.contact_feed_list(_contact_id uuid, _types text[] DEFAULT NULL::text[], _search text DEFAULT NULL::text, _limit integer DEFAULT 200, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _like text := CASE WHEN _search IS NULL OR btrim(_search) = '' THEN NULL ELSE '%' || lower(btrim(_search)) || '%' END;
  _profile_user_id uuid;
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

  SELECT user_id INTO _profile_user_id
  FROM public.profiles
  WHERE id = _contact_id
  LIMIT 1;

  WITH calls_src AS (
    SELECT
      c.id::text AS id,
      'call'::text AS kind,
      c.started_at AS at,
      c.direction::text AS title,
      COALESCE(c.summary, '') AS body,
      jsonb_build_object(
        'public_id', c.public_id,
        'phone', COALESCE(c.phone_from_e164, c.phone_to_e164, c.phone_from_raw, c.phone_to_raw),
        'phone_from', COALESCE(c.phone_from_e164, c.phone_from_raw),
        'phone_to', COALESCE(c.phone_to_e164, c.phone_to_raw),
        'status', c.status::text,
        'direction', c.direction::text,
        'duration', c.duration_seconds,
        'recording_url', c.recording_url,
        'transcript', c.transcript,
        'summary', c.summary
      ) AS meta,
      NULL::text AS author
    FROM public.calls c
    WHERE c.contact_id = _contact_id
      AND (_types IS NULL OR 'call' = ANY(_types))
      AND (
        _like IS NULL
        OR lower(coalesce(c.transcript,'')) LIKE _like
        OR lower(coalesce(c.summary,'')) LIKE _like
        OR lower(coalesce(c.phone_from_e164,'')) LIKE _like
        OR lower(coalesce(c.phone_to_e164,'')) LIKE _like
        OR lower(coalesce(c.phone_from_raw,'')) LIKE _like
        OR lower(coalesce(c.phone_to_raw,'')) LIKE _like
      )
  ),
  sms_src AS (
    SELECT
      s.id::text AS id,
      'sms'::text AS kind,
      s.created_at AS at,
      COALESCE(s.sender, 'SMS')::text AS title,
      s.text AS body,
      jsonb_build_object(
        'phone', s.phone_e164,
        'status', s.status::text,
        'provider', s.provider,
        'sender', s.sender,
        'external_id', s.external_id
      ) AS meta,
      NULL::text AS author
    FROM public.sms_messages s
    WHERE s.contact_id = _contact_id
      AND (_types IS NULL OR 'sms' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(s.text,'')) LIKE _like OR lower(coalesce(s.phone_e164,'')) LIKE _like)
  ),
  tg_src AS (
    SELECT
      m.id::text AS id,
      'telegram'::text AS kind,
      m.created_at AS at,
      COALESCE(m.direction, 'in')::text AS title,
      m.message_text AS body,
      jsonb_build_object(
        'user_id', m.user_id,
        'telegram_user_id', m.telegram_user_id,
        'direction', m.direction,
        'status', m.status
      ) AS meta,
      NULL::text AS author
    FROM public.telegram_messages m
    WHERE _profile_user_id IS NOT NULL
      AND m.user_id = _profile_user_id
      AND (_types IS NULL OR 'telegram' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(m.message_text,'')) LIKE _like)
  ),
  ig_src AS (
    SELECT
      ('instagram:' || m.id::text) AS id,
      'instagram'::text AS kind,
      m.created_at AS at,
      'Instagram'::text AS title,
      m.message_text AS body,
      jsonb_build_object(
        'peer_id', m.peer_id,
        'ig_thread_id', m.ig_thread_id,
        'direction', m.direction,
        'status', m.status,
        'media_url', m.media_url,
        'media_type', m.media_type,
        'instagram_username', c.instagram_username,
        'full_name', c.full_name
      ) AS meta,
      CASE
        WHEN m.direction = 'incoming' THEN COALESCE(c.full_name, c.instagram_username, 'Клиент')
        WHEN m.direction = 'outgoing' THEN 'Оператор'
        ELSE COALESCE(c.full_name, c.instagram_username)
      END AS author
    FROM public.instagram_messages m
    JOIN public.instagram_contacts c
      ON c.instagram_account_id = m.instagram_account_id
     AND c.instagram_user_id   = m.peer_id
    WHERE c.profile_id = _contact_id
      AND (_types IS NULL OR 'instagram' = ANY(_types))
      AND (
        _like IS NULL
        OR lower(coalesce(m.message_text,'')) LIKE _like
        OR lower(coalesce(c.instagram_username,'')) LIKE _like
        OR lower(coalesce(c.full_name,'')) LIKE _like
      )
  ),
  support_src AS (
    SELECT
      ('support:' || tm.id::text) AS id,
      'support'::text AS kind,
      tm.created_at AS at,
      COALESCE(t.ticket_number, 'Обращение') AS title,
      tm.message AS body,
      jsonb_build_object(
        'ticket_id', t.id,
        'ticket_number', t.ticket_number,
        'ticket_status', t.status,
        'ticket_subject', t.subject,
        'author_type', tm.author_type,
        'attachments', COALESCE(tm.attachments, '[]'::jsonb),
        'merged_into_ticket_id', t.merged_into_ticket_id
      ) AS meta,
      COALESCE(
        NULLIF(tm.author_name, ''),
        CASE tm.author_type
          WHEN 'user' THEN 'Клиент'
          WHEN 'support' THEN 'Поддержка'
          WHEN 'system' THEN 'Система'
          ELSE tm.author_type
        END
      ) AS author
    FROM public.ticket_messages tm
    JOIN public.support_tickets t ON t.id = tm.ticket_id
    WHERE t.profile_id = _contact_id
      AND COALESCE(tm.is_internal, false) = false
      AND t.merged_into_ticket_id IS NULL
      AND (_types IS NULL OR 'support' = ANY(_types))
      AND (
        _like IS NULL
        OR lower(coalesce(tm.message,'')) LIKE _like
        OR lower(coalesce(t.ticket_number,'')) LIKE _like
        OR lower(coalesce(tm.author_name,'')) LIKE _like
        OR lower(coalesce(t.subject,'')) LIKE _like
      )
  ),
  email_src AS (
    SELECT
      e.id::text AS id,
      'email'::text AS kind,
      e.created_at AS at,
      e.subject AS title,
      COALESCE(e.body_text, e.body_html) AS body,
      jsonb_build_object(
        'from_email', e.from_email,
        'to_email', e.to_email,
        'direction', e.direction,
        'status', e.status,
        'template_code', e.template_code
      ) AS meta,
      NULL::text AS author
    FROM public.email_logs e
    WHERE e.profile_id = _contact_id
      AND (_types IS NULL OR 'email' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(e.subject,'')) LIKE _like OR lower(coalesce(e.body_text,'')) LIKE _like)
  ),
  tasks AS (
    SELECT
      t.id::text AS id,
      'task'::text AS kind,
      t.created_at AS at,
      t.title,
      t.description AS body,
      jsonb_build_object(
        'public_id', t.public_id,
        'status', t.status,
        'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id,
        'closed_at', t.closed_at,
        'task_type_id', t.task_type_id
      ) AS meta,
      NULL::text AS author
    FROM public.crm_tasks t
    WHERE t.contact_id = _contact_id
      AND (_types IS NULL OR 'task' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(t.title,'')) LIKE _like OR lower(coalesce(t.description,'')) LIKE _like)
  ),
  notes AS (
    SELECT
      n.id::text AS id,
      'note'::text AS kind,
      n.created_at AS at,
      'Заметка'::text AS title,
      n.body,
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
    SELECT
      f.id::text AS id,
      CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm' OR f.mime_type = 'audio/webm') THEN 'voice_note' ELSE 'file' END AS kind,
      f.created_at AS at,
      f.name AS title,
      NULL::text AS body,
      jsonb_build_object(
        'name', f.name,
        'url', f.url,
        'storage_path', f.storage_path,
        'mime_type', f.mime_type,
        'size_bytes', f.size_bytes,
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
    SELECT
      o.id::text AS id,
      'deal'::text AS kind,
      o.created_at AS at,
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
        'order_number', o.order_number,
        'status', o.status::text,
        'final_price', o.final_price,
        'currency', o.currency,
        'product_id', o.product_id,
        'tariff_id', o.tariff_id
      ) AS meta,
      NULL::text AS author
    FROM public.orders_v2 o
    JOIN public.profiles p ON p.user_id = o.user_id
    WHERE p.id = _contact_id
      AND (_types IS NULL OR 'deal' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(o.order_number,'')) LIKE _like)
  ),
  events AS (
    SELECT
      a.id::text AS id,
      'event'::text AS kind,
      a.created_at AS at,
      COALESCE(a.title_snapshot, a.activity_type) AS title,
      a.text_snapshot AS body,
      jsonb_build_object(
        'activity_type', a.activity_type,
        'source_entity_type', a.source_entity_type,
        'source_entity_id', a.source_entity_id,
        'live_event_id', a.live_event_id
      ) AS meta,
      a.author_snapshot AS author
    FROM public.crm_activity_log a
    WHERE (
        (a.contact_id IS NOT NULL AND a.contact_id = _contact_id)
        OR (_profile_user_id IS NOT NULL AND a.user_id = _profile_user_id)
      )
      AND (_types IS NULL OR 'event' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.text_snapshot,'')) LIKE _like OR lower(coalesce(a.title_snapshot,'')) LIKE _like OR lower(coalesce(a.activity_type,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls_src
    UNION ALL SELECT * FROM sms_src
    UNION ALL SELECT * FROM tg_src
    UNION ALL SELECT * FROM ig_src
    UNION ALL SELECT * FROM support_src
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
$function$;
