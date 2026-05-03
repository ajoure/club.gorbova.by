DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '72d76f96-5bbf-4ef8-b7f2-0e1c2b512574','50e89997-451b-4647-a68f-429846663219',
    'cb390d13-4822-41a5-a734-1aa9b47ac560','9857235f-ba79-438f-9049-5a4938e663f1',
    '1e0926a0-0c78-4956-aed2-b559de729160','e5bec945-3cbd-4198-a540-c98ae749c94c',
    'c2363c0f-224c-4553-a467-858f7ccac0ef','c9f419a1-f5fa-4c19-9028-de78f8ffeefc',
    '1203a81b-6d0c-472f-871a-5c750f243db0','607547b2-3e01-4ea0-9be0-851d9d2c5a91',
    'dc9731d4-e3d6-4a69-a51c-3e98a2c6f8a8','b72d69d0-cb11-4203-89dd-2150e153f773',
    '7728fff7-554a-4207-91cf-9551184283e7','345fa412-3ef8-40b4-b1b0-8cd2461f8b8f',
    '20cf5129-80b5-45b7-b71c-b15ead598c23','2db48c49-1b15-4150-a4c1-b1bd0a75b31d',
    'c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5','02302928-7d5d-4bc0-b2ab-c58029b491ac',
    'bbb85f04-8366-4617-b377-f379ed4b91e9'
  ]::uuid[];
  v_backup int; v_audit int; v_deleted int;
BEGIN
  -- 1) backup table (one-shot snapshot)
  CREATE TABLE IF NOT EXISTS public._orders_cohort_b_cleanup_2026_05_backup
    (LIKE public.orders_v2 INCLUDING ALL);

  WITH ins AS (
    INSERT INTO public._orders_cohort_b_cleanup_2026_05_backup
    SELECT * FROM public.orders_v2 WHERE id = ANY(v_ids) FOR UPDATE
    RETURNING 1
  )
  SELECT count(*) INTO v_backup FROM ins;

  -- 2) audit logs
  WITH au AS (
    INSERT INTO public.audit_logs(action, meta)
    SELECT 'orders.cohort_b_orphan_delete_2026_05',
           jsonb_build_object('order_id', o.id, 'order_number', o.order_number,
                              'status', o.status, 'snapshot', to_jsonb(o))
    FROM public.orders_v2 o WHERE o.id = ANY(v_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_audit FROM au;

  -- 3) delete
  WITH del AS (
    DELETE FROM public.orders_v2 WHERE id = ANY(v_ids) RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  -- 4) guard
  IF v_backup <> 19 OR v_audit <> 19 OR v_deleted <> 19 THEN
    RAISE EXCEPTION 'Cohort B Task 2 mismatch: backup=%, audit=%, deleted=%', v_backup, v_audit, v_deleted;
  END IF;

  RAISE NOTICE 'Cohort B Task 2 OK: backup=%, audit=%, deleted=%', v_backup, v_audit, v_deleted;
END $$;