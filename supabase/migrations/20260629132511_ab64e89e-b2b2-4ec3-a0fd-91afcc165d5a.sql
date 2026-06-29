
-- 1) Idempotency: уникальное правило+сделка для авто-задач
CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_auto_rule_deal_uniq
  ON public.crm_tasks (automation_rule_id, deal_id)
  WHERE source = 'auto' AND automation_rule_id IS NOT NULL AND deal_id IS NOT NULL;

-- 2) Унифицируем INSERT-политику на crm_task_notifications для авто-планирования.
--    Чтение уже есть (staff_read). Для INSERT/UPDATE — только service_role (никаких ролей staff).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_task_notifications' AND policyname='crm_task_notifications_service_write') THEN
    CREATE POLICY crm_task_notifications_service_write
      ON public.crm_task_notifications FOR ALL
      TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3) Планировщик уведомлений: idempotent INSERT по (task_id, notification_type)
CREATE UNIQUE INDEX IF NOT EXISTS crm_task_notifications_task_kind_uniq
  ON public.crm_task_notifications (task_id, notification_type);

-- 4) SQL-функция: spawn pending notifications для задач с remind_at/due_at в окне
CREATE OR REPLACE FUNCTION public.crm_tasks_schedule_due_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reminders_planned int := 0;
  v_overdue_planned   int := 0;
BEGIN
  -- reminder: задачи у которых remind_at в прошлом (или совсем близко), задача открыта, ассайни известен
  INSERT INTO public.crm_task_notifications (task_id, notification_type, channel, recipient_user_id, scheduled_at, status, metadata)
  SELECT t.id, 'reminder', 'telegram', t.assignee_user_id, t.remind_at, 'pending', jsonb_build_object('source','cron_tick')
  FROM public.crm_tasks t
  WHERE t.status IN ('open','in_progress')
    AND t.assignee_user_id IS NOT NULL
    AND t.remind_at IS NOT NULL
    AND t.remind_at <= now()
  ON CONFLICT (task_id, notification_type) DO NOTHING;
  GET DIAGNOSTICS v_reminders_planned = ROW_COUNT;

  -- overdue: due_at прошёл, задача всё ещё открыта
  INSERT INTO public.crm_task_notifications (task_id, notification_type, channel, recipient_user_id, scheduled_at, status, metadata)
  SELECT t.id, 'overdue', 'telegram', t.assignee_user_id, t.due_at, 'pending', jsonb_build_object('source','cron_tick')
  FROM public.crm_tasks t
  WHERE t.status IN ('open','in_progress')
    AND t.assignee_user_id IS NOT NULL
    AND t.due_at IS NOT NULL
    AND t.due_at <= now()
  ON CONFLICT (task_id, notification_type) DO NOTHING;
  GET DIAGNOSTICS v_overdue_planned = ROW_COUNT;

  RETURN jsonb_build_object('reminders', v_reminders_planned, 'overdue', v_overdue_planned, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.crm_tasks_schedule_due_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_tasks_schedule_due_notifications() TO service_role;

-- 5) Feature flag в app_settings
INSERT INTO public.app_settings (key, value)
VALUES ('feature_crm_tasks_enabled', to_jsonb(false))
ON CONFLICT (key) DO NOTHING;

-- 6) Hook в create_preorder_deal_atomic — apply_automation после INSERT сделки за фичефлагом
CREATE OR REPLACE FUNCTION public.create_preorder_deal_atomic(
  p_offer_id uuid, p_name text, p_email text, p_phone text,
  p_consent boolean, p_user_id uuid, p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_offer        record;
  v_routing      jsonb;
  v_pipeline_id  uuid;
  v_stage_id     uuid;
  v_norm_email   text;
  v_existing     record;
  v_prereg_id    uuid;
  v_order_id     uuid;
  v_order_num    text;
  v_flag_on      boolean;
  v_auto_tasks   uuid[];
begin
  if p_offer_id is null then raise exception 'offer_id_required' using errcode='22023'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'name_required' using errcode='22023'; end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email' using errcode='22023'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode='22023'; end if;

  v_norm_email := lower(btrim(p_email));

  select o.id, o.offer_type, o.is_active, o.amount, t.product_id, o.tariff_id, o.meta
  into v_offer
  from public.tariff_offers o
  join public.tariffs t on t.id = o.tariff_id
  where o.id = p_offer_id;

  if not found then raise exception 'offer_not_found' using errcode='22023'; end if;
  if v_offer.offer_type <> 'preregistration' then raise exception 'offer_type_not_preregistration' using errcode='22023'; end if;
  if v_offer.is_active is not true then raise exception 'offer_inactive' using errcode='22023'; end if;
  if coalesce(v_offer.amount, 0) <> 0 then raise exception 'offer_amount_must_be_zero' using errcode='22023'; end if;

  v_routing     := coalesce(v_offer.meta -> 'crm_routing', '{}'::jsonb);
  v_pipeline_id := nullif(v_routing ->> 'pipeline_id', '')::uuid;
  v_stage_id    := nullif(v_routing ->> 'stage_on_pending', '')::uuid;
  if v_pipeline_id is null or v_stage_id is null then raise exception 'crm_routing_missing' using errcode='22023'; end if;

  select cp.id as prereg_id, (cp.meta ->> 'order_id')::uuid as order_id
  into v_existing
  from public.course_preregistrations cp
  where (cp.meta ->> 'offer_id')::uuid = p_offer_id
    and lower(cp.email) = v_norm_email
    and cp.status in ('new', 'pending', 'draft')
    and cp.created_at > (now() - interval '24 hours')
  order by cp.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('deduped', true, 'preregistration_id', v_existing.prereg_id, 'order_id', v_existing.order_id);
  end if;

  insert into public.course_preregistrations (
    name, email, phone, product_code, tariff_name, source, consent, status, user_id, meta
  ) values (
    btrim(p_name), v_norm_email, nullif(btrim(coalesce(p_phone,'')), ''),
    'cb20_predzapis', null, 'preorder_form', true, 'new', p_user_id,
    jsonb_build_object(
      'product_id', v_offer.product_id,
      'tariff_id',  v_offer.tariff_id,
      'offer_id',   v_offer.id,
      'source',     'preorder_form',
      'idempotency_key', p_idempotency_key
    )
  ) returning id into v_prereg_id;

  v_order_num := 'PREORDER-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.orders_v2 (
    order_number, user_id, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, paid_amount,
    is_trial, customer_email, customer_phone,
    pipeline_id, pipeline_stage_id, deal_date, meta
  ) values (
    v_order_num, p_user_id, v_offer.product_id, v_offer.tariff_id, v_offer.id,
    0, 0, 'BYN', 'draft'::order_status, 0,
    false, v_norm_email, nullif(btrim(coalesce(p_phone,'')), ''),
    v_pipeline_id, v_stage_id, now(),
    jsonb_build_object(
      'source','preorder_form','is_preorder',true,'is_revenue',false,
      'payment_required',false,'access_grant_required',false,
      'preregistration_id', v_prereg_id, 'idempotency_key', p_idempotency_key
    )
  ) returning id into v_order_id;

  update public.course_preregistrations
  set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('order_id', v_order_id),
      updated_at = now()
  where id = v_prereg_id;

  -- Hook: apply CRM-task automation rules (feature-flagged, never breaks the deal)
  begin
    select coalesce((value)::boolean, false) into v_flag_on
    from public.app_settings where key = 'feature_crm_tasks_enabled';

    if coalesce(v_flag_on, false) then
      v_auto_tasks := public.crm_task_apply_automation(
        v_offer.id, v_order_id,
        jsonb_build_object('source','create_preorder_deal_atomic','prereg_id', v_prereg_id)
      );
    end if;
  exception when others then
    -- свайп исключения — preorder важнее, чем автозадача
    perform 1;
  end;

  return jsonb_build_object(
    'deduped', false,
    'preregistration_id', v_prereg_id,
    'order_id', v_order_id,
    'auto_tasks', coalesce(array_length(v_auto_tasks,1), 0)
  );
end;
$function$;
