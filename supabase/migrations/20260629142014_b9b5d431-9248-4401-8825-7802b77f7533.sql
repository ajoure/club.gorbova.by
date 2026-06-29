DO $smoke$
DECLARE
  v_result jsonb;
  v_prereg_id uuid;
  v_order_id uuid;
  v_task_id uuid;
  v_notif_count int;
  v_final_status text;
  v_test_email text := 'smoke-fa36749f-' || extract(epoch from now())::bigint || '@smoke.local';
BEGIN
  v_result := public.create_preorder_deal_atomic(
    '7b939741-e941-4dbc-b820-803cd7f307bc'::uuid,
    'Smoke Test FA36749F', v_test_email, '+375290000000',
    true, NULL, 'smoke-fa36749f-' || extract(epoch from now())::text
  );
  v_prereg_id := (v_result->>'preregistration_id')::uuid;
  v_order_id  := (v_result->>'order_id')::uuid;
  RAISE NOTICE 'STEP1 preorder result=%', v_result;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'STEP1_failed'; END IF;

  SELECT id INTO v_task_id FROM public.crm_tasks
   WHERE deal_id = v_order_id AND source = 'auto'
   ORDER BY created_at DESC LIMIT 1;
  IF v_task_id IS NULL THEN RAISE EXCEPTION 'STEP2_failed: no auto task'; END IF;
  RAISE NOTICE 'STEP2 task_id=%', v_task_id;

  UPDATE public.crm_tasks
     SET remind_at = now() - interval '1 minute',
         due_at    = now() - interval '30 seconds'
   WHERE id = v_task_id;
  PERFORM public.crm_tasks_schedule_due_notifications();

  SELECT count(*) INTO v_notif_count FROM public.crm_task_notifications
   WHERE task_id = v_task_id AND notification_type IN ('reminder','overdue');
  IF v_notif_count < 2 THEN RAISE EXCEPTION 'STEP3_failed: notifications=%', v_notif_count; END IF;
  RAISE NOTICE 'STEP3 notifications=%', v_notif_count;

  UPDATE public.crm_tasks
     SET status = 'done', closed_at = now(), updated_at = now()
   WHERE id = v_task_id;
  SELECT status INTO v_final_status FROM public.crm_tasks WHERE id = v_task_id;
  IF v_final_status <> 'done' THEN RAISE EXCEPTION 'STEP4_failed: %', v_final_status; END IF;
  RAISE NOTICE 'STEP4 task closed';

  DELETE FROM public.crm_task_notifications WHERE task_id = v_task_id;
  DELETE FROM public.crm_tasks              WHERE id = v_task_id;
  DELETE FROM public.orders_v2              WHERE id = v_order_id;
  DELETE FROM public.course_preregistrations WHERE id = v_prereg_id;

  RAISE NOTICE 'SMOKE_OK prereg=% order=% task=% notif=%',
    v_prereg_id, v_order_id, v_task_id, v_notif_count;
END
$smoke$;