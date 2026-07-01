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
  _profile_user_id uuid;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(_uid,'employee') OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT user_id INTO _profile_user_id FROM public.profiles WHERE id = _contact_id;

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
        'transcript', c.transcript,
        'summary', c.summary
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
  tg AS (
    SELECT tm.id, 'telegram'::text AS kind, tm.created_at AS at,
      CASE tm.direction::text WHEN 'outbound' THEN 'Исходящее' WHEN 'inbound' THEN 'Входящее' ELSE 'Telegram' END AS title,
      tm.message_text AS body,
      jsonb_build_object('direction', tm.direction, 'status', tm.status, 'telegram_user_id', tm.telegram_user_id) AS meta,
      NULL::text AS author
    FROM public.telegram_messages tm
    WHERE _profile_user_id IS NOT NULL AND tm.user_id = _profile_user_id
      AND (_types IS NULL OR 'telegram' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(tm.message_text,'')) LIKE _like)
  ),
  emails AS (
    SELECT el.id, 'email'::text AS kind, el.created_at AS at,
      COALESCE(el.subject, CASE el.direction::text WHEN 'outbound' THEN 'Исходящее письмо' ELSE 'Входящее письмо' END) AS title,
      COALESCE(el.body_text, regexp_replace(coalesce(el.body_html,''), '<[^>]+>', ' ', 'g')) AS body,
      jsonb_build_object(
        'direction', el.direction, 'from', el.from_email, 'to', el.to_email,
        'status', el.status, 'provider', el.provider, 'template', el.template_code
      ) AS meta,
      NULL::text AS author
    FROM public.email_logs el
    WHERE el.profile_id = _contact_id
      AND (_types IS NULL OR 'email' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(el.subject,'')) LIKE _like OR lower(coalesce(el.body_text,'')) LIKE _like)
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
    SELECT f.id,
      CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm' OR f.mime_type = 'audio/webm') THEN 'voice_note' ELSE 'file' END AS kind,
      f.created_at AS at,
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
      AND (_types IS NULL OR 'file' = ANY(_types) OR 'voice_note' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(f.name,'')) LIKE _like)
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
      ) AS meta,
      NULL::text AS author
    FROM public.orders_v2 o
    WHERE (o.profile_id = _contact_id OR (_profile_user_id IS NOT NULL AND o.user_id = _profile_user_id))
      AND (_types IS NULL OR 'deal' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(o.order_number,'')) LIKE _like)
  ),
  events AS (
    SELECT a.id, 'event'::text AS kind, a.created_at AS at,
      CASE a.activity_type
        WHEN 'contact_created' THEN 'Контакт создан'
        WHEN 'contact_updated' THEN 'Контакт обновлён'
        WHEN 'new_profile_created' THEN 'Регистрация пользователя'
        WHEN 'deal_created' THEN 'Сделка создана'
        WHEN 'deal_updated' THEN 'Сделка обновлена'
        WHEN 'deal_stage_changed' THEN 'Смена стадии сделки'
        WHEN 'deal_won' THEN 'Сделка выиграна'
        WHEN 'deal_lost' THEN 'Сделка проиграна'
        WHEN 'payment_received' THEN 'Платёж получен'
        WHEN 'subscription_created' THEN 'Подписка оформлена'
        WHEN 'subscription_renewed' THEN 'Подписка продлена'
        WHEN 'subscription_cancelled' THEN 'Подписка отменена'
        WHEN 'access_granted' THEN 'Доступ выдан'
        WHEN 'access_revoked' THEN 'Доступ отозван'
        WHEN 'telegram_linked' THEN 'Telegram привязан'
        WHEN 'trial_started' THEN 'Триал начат'
        WHEN 'trial_expired' THEN 'Триал завершён'
        ELSE COALESCE(a.title_snapshot, a.activity_type)
      END AS title,
      a.text_snapshot AS body,
      jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type) AS meta,
      a.author_snapshot AS author
    FROM public.crm_activity_log a
    WHERE (a.contact_id = _contact_id OR (_profile_user_id IS NOT NULL AND a.user_id = _profile_user_id))
      AND (_types IS NULL OR 'event' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.title_snapshot,'')) LIKE _like OR lower(coalesce(a.text_snapshot,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls
    UNION ALL SELECT * FROM sms
    UNION ALL SELECT * FROM tg
    UNION ALL SELECT * FROM emails
    UNION ALL SELECT * FROM tasks
    UNION ALL SELECT * FROM notes
    UNION ALL SELECT * FROM files
    UNION ALL SELECT * FROM deals
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