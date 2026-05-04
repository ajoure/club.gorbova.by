DO $$
DECLARE
  v_target_id uuid := '5aa1c624-b390-4fd5-af0d-0b849d40dd11';
  v_canonical_id uuid := '7e47007c-5141-4a3a-b98b-a0808262f553';
  v_payment_id uuid := 'e9e365de-bbb5-41c6-9061-263c83b4c71a';
  v_snapshot jsonb;
  v_payments_count int;
  v_subs_count int;
  v_ledger_count int;
  v_ent_count int;
  v_backup_count int;
  v_audit_count int;
  v_deleted_count int;
BEGIN
  -- 1. Snapshot
  SELECT to_jsonb(o.*) INTO v_snapshot
  FROM public.orders_v2 o
  WHERE o.id = v_target_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'Target order % not found — aborting', v_target_id;
  END IF;

  -- 2. Re-verify guards in-transaction
  SELECT count(*) INTO v_payments_count
  FROM public.payments_v2 WHERE order_id = v_target_id;

  SELECT count(*) INTO v_subs_count
  FROM public.subscriptions_v2
  WHERE order_id = v_target_id
     OR (meta->>'origin_order_id')::uuid = v_target_id
     OR meta->'extended_by_orders' ? v_target_id::text;

  SELECT count(*) INTO v_ledger_count
  FROM public.access_grant_ledger
  WHERE order_id = v_target_id OR source_order_id = v_target_id;

  SELECT count(*) INTO v_ent_count
  FROM public.entitlements
  WHERE (meta->>'order_id')::text = v_target_id::text
     OR (meta->>'source_order_id')::text = v_target_id::text;

  IF v_payments_count <> 0 OR v_subs_count <> 0 OR v_ledger_count <> 0 OR v_ent_count <> 0 THEN
    RAISE EXCEPTION 'Guard failed: payments=%, subs=%, ledger=%, entitlements=% — aborting',
      v_payments_count, v_subs_count, v_ledger_count, v_ent_count;
  END IF;

  -- 3. Backup (table уже создана в Task 2)
  INSERT INTO public._orders_cohort_b_cleanup_2026_05_backup
  SELECT * FROM public.orders_v2 WHERE id = v_target_id;
  GET DIAGNOSTICS v_backup_count = ROW_COUNT;

  IF v_backup_count <> 1 THEN
    RAISE EXCEPTION 'Backup rowcount=% (expected 1) — aborting', v_backup_count;
  END IF;

  -- 4. Audit
  INSERT INTO public.audit_logs(action, meta)
  VALUES (
    'orders.cohort_b_admin_duplicate_delete_2026_05',
    jsonb_build_object(
      'order_id', v_target_id,
      'canonical_order_id', v_canonical_id,
      'payment_id', v_payment_id,
      'actor_label', 'system_cleanup_cohort_b_task3',
      'reason', 'admin_duplicate_over_already_linked_payment',
      'guards', jsonb_build_object(
        'payments_v2', v_payments_count,
        'subscriptions_v2', v_subs_count,
        'access_grant_ledger', v_ledger_count,
        'entitlements', v_ent_count
      ),
      'before_snapshot', v_snapshot
    )
  );
  GET DIAGNOSTICS v_audit_count = ROW_COUNT;

  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Audit rowcount=% (expected 1) — aborting', v_audit_count;
  END IF;

  -- 5. DELETE with strict rowcount guard
  DELETE FROM public.orders_v2 WHERE id = v_target_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'Delete rowcount=% (expected 1) — aborting', v_deleted_count;
  END IF;

  RAISE NOTICE 'Task 3 OK: backup=%, audit=%, deleted=%', v_backup_count, v_audit_count, v_deleted_count;
END $$;