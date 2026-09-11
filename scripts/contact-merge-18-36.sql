-- Canonical Lovable Cloud only. Default: preflight; renderer controls execution.
-- No auth/login edits, payment operations, access grants, or row deletion.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $merge$
DECLARE
  do_execute boolean := /* EXECUTE_FLAG */ false;
  master_id constant uuid := '303563e8-1837-4de9-a69a-8921a799b699';
  old_id constant uuid := '8cc39a42-6661-417d-b0c0-f1c24ccb6acf';
  login_id constant uuid := '64ccd4f9-ca69-4903-90b7-5a49df7fef07';
  purchase_id constant uuid := 'c0133322-bf2b-4e5c-84b9-749ca550ccba';
  history_id constant uuid := '2de85fb1-697d-5786-87c2-450f4d4acf26';
  master_before jsonb; old_before jsonb; order_before jsonb; order_after jsonb;
  dep record; n bigint; changed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(71361836);
  PERFORM id FROM public.profiles WHERE id IN (master_id, old_id) ORDER BY id FOR UPDATE;
  SELECT to_jsonb(p) INTO master_before FROM public.profiles p WHERE id = master_id;
  SELECT to_jsonb(p) INTO old_before FROM public.profiles p WHERE id = old_id;
  IF master_before IS NULL OR old_before IS NULL THEN RAISE EXCEPTION 'Pilot profile missing'; END IF;
  IF master_before->>'user_id' IS DISTINCT FROM login_id::text
     OR master_before->>'status' IS DISTINCT FROM 'active'
     OR coalesce((master_before->>'is_archived')::boolean, false)
     OR master_before->>'merged_to_profile_id' IS NOT NULL
     OR old_before->>'user_id' IS NOT NULL
     OR old_before->>'status' IS DISTINCT FROM 'archived'
     OR NOT coalesce((old_before->>'is_archived')::boolean, false)
     OR old_before->>'telegram_user_id' IS NOT NULL
  THEN RAISE EXCEPTION 'Pilot identity state changed'; END IF;
  IF nullif(lower(btrim(master_before->>'email')), '') IS NULL
     OR lower(btrim(master_before->>'email')) IS DISTINCT FROM lower(btrim(old_before->>'email'))
     OR (SELECT count(*) FROM public.profiles WHERE user_id = login_id) <> 1
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = login_id
       AND lower(btrim(email)) = lower(btrim(master_before->>'email')))
  THEN RAISE EXCEPTION 'Pilot login identity mismatch'; END IF;

  PERFORM id FROM public.orders_v2 WHERE id = purchase_id FOR UPDATE;
  SELECT to_jsonb(o) INTO order_before FROM public.orders_v2 o WHERE id = purchase_id;
  IF order_before IS NULL THEN RAISE EXCEPTION 'Pilot purchase missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.merge_history WHERE id = history_id) THEN
    IF old_before->>'merged_to_profile_id' IS DISTINCT FROM master_id::text
       OR order_before->>'profile_id' IS DISTINCT FROM master_id::text
       OR order_before->>'user_id' IS DISTINCT FROM login_id::text
    THEN RAISE EXCEPTION 'Pilot replay conflicts with current ownership'; END IF;
    RETURN;
  END IF;
  IF old_before->>'merged_to_profile_id' IS NOT NULL
     OR order_before->>'profile_id' IS DISTINCT FROM old_id::text
     OR (order_before->>'user_id' IS NOT NULL AND order_before->>'user_id' <> old_id::text)
     OR order_before->>'status' IS DISTINCT FROM 'paid'
     OR coalesce((order_before->>'is_deleted')::boolean, false)
     OR order_before->>'product_id' IS DISTINCT FROM '7101ed3c-7839-4a74-ad95-aa0660369b22'
     OR order_before->>'tariff_id' IS DISTINCT FROM '543940b1-99da-47f3-accc-671ad5b11afe'
     OR coalesce((order_before->>'paid_amount')::numeric, 0) <> 0
  THEN RAISE EXCEPTION 'Pilot purchase state changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders_v2 WHERE profile_id = master_id OR user_id = login_id)
     OR EXISTS (SELECT 1 FROM public.payments_v2 WHERE order_id = purchase_id)
     OR EXISTS (SELECT 1 FROM public.subscriptions_v2 WHERE order_id = purchase_id)
     OR EXISTS (SELECT 1 FROM public.entitlements WHERE order_id = purchase_id)
     OR EXISTS (SELECT 1 FROM public.crm_pipeline_automation_rules WHERE status = 'active')
  THEN RAISE EXCEPTION 'Pilot dependency or automation state changed'; END IF;

  -- Fail closed on any unreviewed current ownership reference, including no-FK tables.
  FOR dep IN
    SELECT DISTINCT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.udt_name = 'uuid'
      AND c.table_name !~ '(^_|backup|_archive$)'
      AND (c.column_name IN ('profile_id','user_id','contact_id','owner_profile_id','linked_profile_id','matched_profile_id','master_profile_id','merged_profile_id')
        OR EXISTS (
          SELECT 1 FROM pg_constraint fk
          JOIN pg_class rel ON rel.oid = fk.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
          JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(fk.conkey)
          WHERE fk.contype = 'f' AND fk.confrelid = 'public.profiles'::regclass
            AND ns.nspname = c.table_schema AND rel.relname = c.table_name AND att.attname = c.column_name))
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', dep.table_name, dep.column_name)
      INTO n USING old_id;
    IF dep.table_name = 'orders_v2' AND dep.column_name = 'profile_id' THEN
      IF n <> 1 THEN RAISE EXCEPTION 'Pilot order count changed'; END IF;
    ELSIF dep.table_name = 'orders_v2' AND dep.column_name = 'user_id' THEN
      IF n <> (CASE WHEN order_before->>'user_id' = old_id::text THEN 1 ELSE 0 END)
      THEN RAISE EXCEPTION 'Pilot legacy user count changed'; END IF;
    ELSIF n <> 0 THEN
      RAISE EXCEPTION 'Unreviewed pilot dependency %.% count %', dep.table_name, dep.column_name, n;
    END IF;
  END LOOP;
  IF NOT do_execute THEN RETURN; END IF;

  UPDATE public.orders_v2 SET profile_id = master_id, user_id = login_id WHERE id = purchase_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Unexpected pilot order write count'; END IF;
  SELECT to_jsonb(o) INTO order_after FROM public.orders_v2 o WHERE id = purchase_id;
  IF order_after->>'profile_id' IS DISTINCT FROM master_id::text
     OR order_after->>'user_id' IS DISTINCT FROM login_id::text
     OR (order_after - ARRAY['profile_id','user_id','updated_at'])
        IS DISTINCT FROM (order_before - ARRAY['profile_id','user_id','updated_at'])
  THEN RAISE EXCEPTION 'Pilot changed fields beyond ownership'; END IF;

  UPDATE public.profiles SET merged_to_profile_id = master_id, duplicate_flag = 'none' WHERE id = old_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Unexpected pilot profile write count'; END IF;
  IF (SELECT to_jsonb(p) FROM public.profiles p WHERE id = master_id) IS DISTINCT FROM master_before
  THEN RAISE EXCEPTION 'Pilot changed active login profile'; END IF;
  IF (SELECT to_jsonb(p) - ARRAY['merged_to_profile_id','duplicate_flag','updated_at']
      FROM public.profiles p WHERE id = old_id)
      IS DISTINCT FROM (old_before - ARRAY['merged_to_profile_id','duplicate_flag','updated_at'])
  THEN RAISE EXCEPTION 'Pilot changed archived fields beyond merge linkage'; END IF;

  INSERT INTO public.merge_history(id, master_profile_id, merged_profile_id, merged_data)
  VALUES (history_id, master_id, old_id, jsonb_build_object(
    'batch_id','archived-active-18-36-20260911', 'source_ref','18:36',
    'merged_profile_ids',jsonb_build_array(old_id), 'merged_auth_user_ids','[]'::jsonb,
    'merged_profiles_snapshot',jsonb_build_array(old_before), 'master_before',master_before,
    'orders_before',jsonb_build_array(order_before), 'orders_after',jsonb_build_array(order_after),
    'transferred',jsonb_build_object('orders',1,'payments',0,'subscriptions',0,'entitlements',0),
    'login_email_changed',false, 'rollback_strategy','exact_order_ids_journal'));
  INSERT INTO public.audit_logs(action, actor_type, actor_label, target_user_id, meta)
  VALUES ('CONTACT_MERGED','system','Owner-approved historical purchase reconciliation',login_id,
    jsonb_build_object('master_profile_id',master_id,'merged_profile_ids',jsonb_build_array(old_id),
      'merge_history_id',history_id,'source_ref','18:36','can_unmerge',false,
      'rollback_strategy','exact_order_ids_journal','orders_transferred',1));

  IF EXISTS (SELECT 1 FROM public.payments_v2 WHERE order_id = purchase_id)
     OR EXISTS (SELECT 1 FROM public.subscriptions_v2 WHERE order_id = purchase_id)
     OR EXISTS (SELECT 1 FROM public.entitlements WHERE order_id = purchase_id)
  THEN RAISE EXCEPTION 'Unexpected pilot payment/access side effect'; END IF;
END;
$merge$;
SELECT
  (SELECT count(*) FROM public.merge_history WHERE id = '2de85fb1-697d-5786-87c2-450f4d4acf26') AS pilot_merge_records,
  (SELECT count(*) FROM public.orders_v2 WHERE id = 'c0133322-bf2b-4e5c-84b9-749ca550ccba'
    AND profile_id = '303563e8-1837-4de9-a69a-8921a799b699'
    AND user_id = '64ccd4f9-ca69-4903-90b7-5a49df7fef07') AS pilot_orders_on_active_account;
COMMIT;
