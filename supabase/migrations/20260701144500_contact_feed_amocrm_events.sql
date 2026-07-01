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
  _contact_email text;
  _contact_phone text;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF NOT (public.has_role_v2(_uid, 'employee') OR public.has_role_v2(_uid, 'admin') OR public.has_role_v2(_uid, 'super_admin')) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT user_id, email, phone INTO _profile_user_id, _contact_email, _contact_phone
  FROM public.profiles WHERE id = _contact_id LIMIT 1;

  WITH actor_names AS (
    SELECT p.user_id, COALESCE(NULLIF(p.full_name,''), p.email) AS name FROM public.profiles p WHERE p.user_id IS NOT NULL
  ),
  contact_orders AS (
    SELECT o.* FROM public.orders_v2 o
    WHERE o.profile_id = _contact_id
       OR (_profile_user_id IS NOT NULL AND o.user_id = _profile_user_id)
       OR (_contact_email IS NOT NULL AND lower(o.customer_email) = lower(_contact_email))
       OR (_contact_phone IS NOT NULL AND regexp_replace(coalesce(o.customer_phone,''), '\\D', '', 'g') = regexp_replace(_contact_phone, '\\D', '', 'g'))
  ),
  calls_src AS (
    SELECT c.id::text id, 'call'::text kind, COALESCE(c.started_at,c.created_at) at,
      CASE c.direction::text WHEN 'inbound' THEN 'Входящий звонок' WHEN 'outbound' THEN 'Исходящий звонок' ELSE 'Звонок' END title,
      COALESCE(c.summary,'') body,
      jsonb_build_object('public_id',c.public_id,'phone',COALESCE(c.phone_from_e164,c.phone_to_e164,c.phone_from_raw,c.phone_to_raw),'phone_from',COALESCE(c.phone_from_e164,c.phone_from_raw),'phone_to',COALESCE(c.phone_to_e164,c.phone_to_raw),'status',c.status::text,'direction',c.direction::text,'duration',c.duration_seconds,'recording_url',c.recording_url,'transcript',c.transcript,'summary',c.summary) meta,
      (SELECT name FROM actor_names an WHERE an.user_id = COALESCE(c.manager_user_id,c.created_by) LIMIT 1) author
    FROM public.calls c
    WHERE c.contact_id = _contact_id AND (_types IS NULL OR 'call'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(c.transcript,'')) LIKE _like OR lower(coalesce(c.summary,'')) LIKE _like OR lower(coalesce(c.phone_from_e164,'')) LIKE _like OR lower(coalesce(c.phone_to_e164,'')) LIKE _like OR lower(coalesce(c.phone_from_raw,'')) LIKE _like OR lower(coalesce(c.phone_to_raw,'')) LIKE _like)
  ),
  sms_src AS (
    SELECT s.id::text, 'sms'::text, s.created_at,
      CASE WHEN coalesce(s.status,'')='sent' THEN 'SMS отправлено' ELSE 'SMS: '||coalesce(s.status,'без статуса') END,
      s.text,
      jsonb_build_object('phone',s.phone_e164,'status',s.status,'provider',s.provider,'sender',s.sender,'external_id',s.external_id),
      (SELECT name FROM actor_names an WHERE an.user_id = s.initiator_user_id LIMIT 1)
    FROM public.sms_messages s
    WHERE s.contact_id = _contact_id AND (_types IS NULL OR 'sms'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(s.text,'')) LIKE _like OR lower(coalesce(s.phone_e164,'')) LIKE _like)
  ),
  tg_src AS (
    SELECT m.id::text, 'telegram'::text, m.created_at,
      CASE m.direction WHEN 'out' THEN 'Telegram отправлен' WHEN 'in' THEN 'Telegram получен' ELSE 'Telegram' END,
      m.message_text,
      jsonb_build_object('user_id',m.user_id,'telegram_user_id',m.telegram_user_id,'direction',m.direction,'status',m.status),
      (SELECT name FROM actor_names an WHERE an.user_id = m.sent_by_admin LIMIT 1)
    FROM public.telegram_messages m
    WHERE _profile_user_id IS NOT NULL AND m.user_id = _profile_user_id AND (_types IS NULL OR 'telegram'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(m.message_text,'')) LIKE _like)
  ),
  email_src AS (
    SELECT e.id::text, 'email'::text, e.created_at,
      CASE e.direction WHEN 'out' THEN 'Письмо отправлено' WHEN 'in' THEN 'Письмо получено' ELSE 'Письмо' END || COALESCE(': '||NULLIF(e.subject,''), ''),
      COALESCE(e.body_text, regexp_replace(coalesce(e.body_html,''), '<[^>]+>', ' ', 'g')),
      jsonb_build_object('from_email',e.from_email,'to_email',e.to_email,'direction',e.direction,'status',e.status,'template_code',e.template_code,'subject',e.subject),
      NULL::text
    FROM public.email_logs e
    WHERE (e.profile_id = _contact_id OR (_profile_user_id IS NOT NULL AND e.user_id = _profile_user_id) OR lower(coalesce(e.to_email,''))=lower(coalesce(_contact_email,'')) OR lower(coalesce(e.from_email,''))=lower(coalesce(_contact_email,'')))
      AND (_types IS NULL OR 'email'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(e.subject,'')) LIKE _like OR lower(coalesce(e.body_text,'')) LIKE _like OR lower(coalesce(e.body_html,'')) LIKE _like)
  ),
  tasks AS (
    SELECT t.id::text, 'task'::text, COALESCE(t.updated_at,t.created_at),
      CASE WHEN t.status='done' THEN 'Задача закрыта: ' ELSE 'Задача создана: ' END || t.title,
      COALESCE(t.result_comment,t.description),
      jsonb_build_object('public_id',t.public_id,'status',t.status,'due_at',t.due_at,'assignee_user_id',t.assignee_user_id,'closed_at',t.closed_at,'task_type_id',t.task_type_id),
      (SELECT name FROM actor_names an WHERE an.user_id = COALESCE(t.updated_by,t.created_by,t.assignee_user_id) LIMIT 1)
    FROM public.crm_tasks t
    WHERE t.contact_id = _contact_id AND (_types IS NULL OR 'task'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(t.title,'')) LIKE _like OR lower(coalesce(t.description,'')) LIKE _like OR lower(coalesce(t.result_comment,'')) LIKE _like)
  ),
  notes AS (
    SELECT n.id::text, 'note'::text, n.created_at, 'Заметка'::text, n.body,
      jsonb_build_object('author_id',n.author_id,'can_delete',(n.author_id=_uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))),
      (SELECT name FROM actor_names an WHERE an.user_id=n.author_id LIMIT 1)
    FROM public.contact_notes n
    WHERE n.contact_id = _contact_id AND (_types IS NULL OR 'note'=ANY(_types)) AND (_like IS NULL OR lower(coalesce(n.body,'')) LIKE _like)
  ),
  files AS (
    SELECT f.id::text,
      CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm' OR f.mime_type='audio/webm') THEN 'voice_note' ELSE 'file' END,
      f.created_at,
      f.name,
      NULL::text,
      jsonb_build_object('name',f.name,'url',f.url,'storage_path',f.storage_path,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'uploader_id',f.uploader_id,'transcript',f.meta->>'transcript','summary',f.meta->>'summary','transcribe_status',f.meta->>'transcribe_status','transcribe_reason',f.meta->>'transcribe_reason','can_delete',(f.uploader_id=_uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))),
      (SELECT name FROM actor_names an WHERE an.user_id=f.uploader_id LIMIT 1)
    FROM public.contact_files f
    WHERE f.contact_id = _contact_id AND (_types IS NULL OR 'file'=ANY(_types) OR 'voice_note'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(f.name,'')) LIKE _like OR lower(coalesce(f.meta->>'transcript','')) LIKE _like OR lower(coalesce(f.meta->>'summary','')) LIKE _like)
  ),
  deals AS (
    SELECT o.id::text, 'deal'::text, COALESCE(o.deal_date,o.updated_at,o.created_at),
      'Сделка ' || COALESCE(o.order_number, substr(o.id::text,1,8)),
      concat_ws(E'\n',
        CASE o.status::text WHEN 'paid' THEN 'Оплачено' WHEN 'pending' THEN 'Ожидает оплаты' WHEN 'canceled' THEN 'Отменена' WHEN 'refunded' THEN 'Возврат' WHEN 'partial' THEN 'Частичная оплата' WHEN 'failed' THEN 'Ошибка оплаты' WHEN 'draft' THEN 'Черновик' ELSE o.status::text END,
        COALESCE('Продукт: '||p.name, NULL), COALESCE('Тариф: '||tr.name, NULL),
        CASE WHEN o.final_price IS NOT NULL THEN 'Сумма: '||o.final_price::text||' '||coalesce(o.currency,'') END),
      jsonb_build_object('order_number',o.order_number,'status',o.status::text,'final_price',o.final_price,'currency',o.currency,'product_id',o.product_id,'product_name',p.name,'tariff_id',o.tariff_id,'tariff_name',tr.name),
      'Система'::text
    FROM contact_orders o
    LEFT JOIN public.products_v2 p ON p.id=o.product_id
    LEFT JOIN public.tariffs tr ON tr.id=o.tariff_id
    WHERE (_types IS NULL OR 'deal'=ANY(_types)) AND (_like IS NULL OR lower(coalesce(o.order_number,'')) LIKE _like OR lower(coalesce(p.name,'')) LIKE _like OR lower(coalesce(tr.name,'')) LIKE _like)
  ),
  pay_events AS (
    SELECT pay.id::text, 'event'::text, COALESCE(pay.paid_at,pay.updated_at,pay.created_at),
      CASE pay.status::text WHEN 'succeeded' THEN 'Платёж прошёл' WHEN 'refunded' THEN 'Платёж возвращён' WHEN 'failed' THEN 'Платёж не прошёл' WHEN 'pending' THEN 'Платёж ожидает обработки' ELSE 'Платёж: '||pay.status::text END,
      concat_ws(E'\n','Сумма: '||coalesce(pay.amount::text,'0')||' '||coalesce(pay.currency,''),COALESCE('Продукт: '||coalesce(pay.product_name_raw,p.name),NULL),COALESCE('Заказ: '||o.order_number,NULL),COALESCE('Провайдер: '||pay.provider,NULL),CASE WHEN pay.error_message IS NOT NULL THEN 'Ошибка: '||pay.error_message END),
      jsonb_build_object('event_source','payment','payment_id',pay.id,'order_id',pay.order_id,'order_number',o.order_number,'status',pay.status::text,'amount',pay.amount,'currency',pay.currency,'provider',pay.provider,'transaction_type',pay.transaction_type),
      'Система'::text
    FROM public.payments_v2 pay
    LEFT JOIN public.orders_v2 o ON o.id=pay.order_id
    LEFT JOIN public.products_v2 p ON p.id=o.product_id
    WHERE (pay.profile_id=_contact_id OR (_profile_user_id IS NOT NULL AND pay.user_id=_profile_user_id) OR pay.order_id IN (SELECT id FROM contact_orders))
      AND (_types IS NULL OR 'event'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(pay.provider_payment_id,'')) LIKE _like OR lower(coalesce(pay.product_name_raw,'')) LIKE _like OR lower(coalesce(o.order_number,'')) LIKE _like)
  ),
  audit_events AS (
    SELECT a.id::text, 'event'::text, a.created_at,
      CASE
        WHEN a.action ILIKE '%delete%' OR a.action ILIKE '%removed%' THEN 'Удаление данных'
        WHEN a.action ILIKE '%create%' OR a.action ILIKE '%added%' OR a.action ILIKE '%insert%' THEN 'Добавление данных'
        WHEN a.action ILIKE '%update%' OR a.action ILIKE '%changed%' OR a.action ILIKE '%reset%' THEN 'Изменение данных'
        WHEN a.action ILIKE '%trial%' THEN 'Триал / доступ'
        WHEN a.action ILIKE '%entitlement%' OR a.action ILIKE '%grant%' THEN 'Выдача доступа'
        WHEN a.action ILIKE '%payment%' OR a.action ILIKE '%bepaid%' THEN 'Платёжная операция'
        WHEN a.action ILIKE '%email%' THEN 'Письмо / уведомление'
        ELSE 'Событие платформы'
      END AS title,
      concat_ws(E'\n','Действие: '||a.action,COALESCE('Объект: '||NULLIF(a.entity_type,''),NULL),CASE WHEN a.entity_id IS NOT NULL THEN 'ID: '||a.entity_id END,CASE WHEN a.meta IS NOT NULL AND a.meta <> '{}'::jsonb THEN 'Детали: '||left(a.meta::text,700) END),
      jsonb_build_object('event_source','audit','action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor_user_id',a.actor_user_id,'actor_type',a.actor_type,'raw_meta',a.meta),
      COALESCE(NULLIF(a.actor_label,''),(SELECT name FROM actor_names an WHERE an.user_id=a.actor_user_id LIMIT 1),'Система')
    FROM public.audit_logs a
    WHERE (
      a.target_user_id = _profile_user_id OR a.actor_user_id = _profile_user_id OR a.entity_id = _contact_id::text OR a.entity_id IN (SELECT id::text FROM contact_orders)
      OR a.meta::text ILIKE '%'||_contact_id::text||'%'
      OR (_profile_user_id IS NOT NULL AND a.meta::text ILIKE '%'||_profile_user_id::text||'%')
      OR EXISTS (SELECT 1 FROM contact_orders co WHERE a.meta::text ILIKE '%'||co.id::text||'%' OR (co.order_number IS NOT NULL AND a.meta::text ILIKE '%'||co.order_number||'%'))
    )
      AND (_types IS NULL OR 'event'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.action,'')) LIKE _like OR lower(coalesce(a.actor_label,'')) LIKE _like OR lower(coalesce(a.meta::text,'')) LIKE _like)
    ORDER BY a.created_at DESC
    LIMIT 400
  ),
  activity_events AS (
    SELECT a.id::text, 'event'::text, a.created_at,
      COALESCE(NULLIF(a.title_snapshot,''), a.activity_type, 'Событие CRM'), a.text_snapshot,
      jsonb_build_object('event_source','crm_activity','activity_type',a.activity_type,'source_entity_type',a.source_entity_type,'source_entity_id',a.source_entity_id,'live_event_id',a.live_event_id),
      COALESCE(NULLIF(a.author_snapshot,''),(SELECT name FROM actor_names an WHERE an.user_id=a.user_id LIMIT 1),'Система')
    FROM public.crm_activity_log a
    WHERE ((a.contact_id IS NOT NULL AND a.contact_id=_contact_id) OR (_profile_user_id IS NOT NULL AND a.user_id=_profile_user_id) OR a.source_entity_id IN (SELECT id FROM contact_orders))
      AND (_types IS NULL OR 'event'=ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.text_snapshot,'')) LIKE _like OR lower(coalesce(a.title_snapshot,'')) LIKE _like OR lower(coalesce(a.activity_type,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls_src UNION ALL SELECT * FROM sms_src UNION ALL SELECT * FROM tg_src UNION ALL SELECT * FROM email_src UNION ALL SELECT * FROM tasks UNION ALL SELECT * FROM notes UNION ALL SELECT * FROM files UNION ALL SELECT * FROM deals UNION ALL SELECT * FROM pay_events UNION ALL SELECT * FROM audit_events UNION ALL SELECT * FROM activity_events
  )
  SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.at DESC NULLS LAST),'[]'::jsonb) INTO _result
  FROM (SELECT * FROM all_events ORDER BY at DESC NULLS LAST LIMIT greatest(1,least(coalesce(_limit,200),500)) OFFSET greatest(0,coalesce(_offset,0))) e;

  RETURN COALESCE(_result,'[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.contact_feed_list(uuid,text[],text,integer,integer) TO authenticated;
