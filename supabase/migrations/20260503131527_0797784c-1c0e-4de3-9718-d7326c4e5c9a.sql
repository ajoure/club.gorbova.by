-- =========================================================================
-- Cohort B Task 1 — Repair 3 paid_without_payment cases (2026-05) [retry]
-- =========================================================================

-- CASE 1.1
DO $$
DECLARE
  v_order_id   uuid;
  v_payment_id uuid := 'c42ea072-a927-4f84-9990-1ce0b4a09e3c'::uuid;
  v_order      record;
  v_payment    record;
  v_collision  int;
  v_rowcount   int;
  v_before     jsonb;
  v_after      jsonb;
BEGIN
  SELECT id INTO v_order_id
  FROM public.orders_v2
  WHERE id::text LIKE '97e22bb3-%'
    AND meta->>'payment_id' = v_payment_id::text
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: order 97e22bb3 not found by meta.payment_id';
  END IF;

  SELECT * INTO v_order   FROM public.orders_v2   WHERE id = v_order_id   FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments_v2 WHERE id = v_payment_id FOR UPDATE;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: order.status=% expected paid', v_order.status;
  END IF;
  IF v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: payment.status=% expected succeeded', v_payment.status;
  END IF;
  IF v_payment.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: payment.order_id already set: %', v_payment.order_id;
  END IF;

  SELECT count(*) INTO v_collision
  FROM public.orders_v2
  WHERE meta->>'payment_id' = v_payment_id::text
    AND id <> v_order_id;
  IF v_collision > 0 THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: collision=% other orders share meta.payment_id', v_collision;
  END IF;

  v_before := jsonb_build_object(
    'payment_id', v_payment.id,
    'payment_order_id_before', v_payment.order_id,
    'order_id', v_order.id,
    'order_status', v_order.status
  );

  UPDATE public.payments_v2
  SET order_id = v_order_id,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'repair_2026_05', jsonb_build_object(
          'action', 'link_payment_to_historical_order',
          'order_id', v_order_id,
          'reason', 'admin_bulk_from_payments deal-only orphan'
        )
      )
  WHERE id = v_payment_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'CASE_1_1_ABORT: rowcount=% expected 1', v_rowcount;
  END IF;

  SELECT jsonb_build_object('payment_order_id_after', order_id)
    INTO v_after FROM public.payments_v2 WHERE id = v_payment_id;

  INSERT INTO public.audit_logs(action, meta)
  VALUES ('orders.repair_link_payment_2026_05',
          jsonb_build_object('case','1.1','before',v_before,'after',v_after));

  RAISE NOTICE 'CASE_1_1_OK: payment % linked to order %', v_payment_id, v_order_id;
END$$;

-- CASE 1.2
DO $$
DECLARE
  v_sub_id            uuid;
  v_old_order_id      uuid;
  v_canonical_id      uuid;
  v_sub               record;
  v_old_order         record;
  v_canonical         record;
  v_canonical_payment int;
  v_canonical_subs    int;
  v_rowcount          int;
  v_before            jsonb;
  v_after             jsonb;
BEGIN
  SELECT id INTO v_sub_id       FROM public.subscriptions_v2 WHERE id::text LIKE 'cd8791aa-%' LIMIT 1;
  SELECT id INTO v_old_order_id FROM public.orders_v2        WHERE id::text LIKE 'c0af8ad4-%' LIMIT 1;
  SELECT id INTO v_canonical_id FROM public.orders_v2        WHERE id::text LIKE '1ea274b1-%' LIMIT 1;

  IF v_sub_id IS NULL OR v_old_order_id IS NULL OR v_canonical_id IS NULL THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: missing ids sub=% old=% canonical=%',
      v_sub_id, v_old_order_id, v_canonical_id;
  END IF;

  SELECT * INTO v_sub       FROM public.subscriptions_v2 WHERE id = v_sub_id       FOR UPDATE;
  SELECT * INTO v_old_order FROM public.orders_v2        WHERE id = v_old_order_id FOR UPDATE;
  SELECT * INTO v_canonical FROM public.orders_v2        WHERE id = v_canonical_id FOR UPDATE;

  IF v_sub.order_id <> v_old_order_id THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: sub.order_id=% expected %', v_sub.order_id, v_old_order_id;
  END IF;

  IF (v_canonical.meta->>'legacy_order_id') IS DISTINCT FROM v_old_order_id::text
     AND (v_old_order.meta->>'legacy_order_id') IS DISTINCT FROM v_canonical_id::text
     AND (v_old_order.meta->>'bepaid_subscription_id') IS DISTINCT FROM (v_canonical.meta->>'bepaid_subscription_id') THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: legacy linkage mismatch';
  END IF;

  SELECT count(*) INTO v_canonical_payment
  FROM public.payments_v2 WHERE order_id = v_canonical_id AND status = 'succeeded';
  IF v_canonical_payment < 1 THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: canonical % no succeeded payment', v_canonical_id;
  END IF;

  SELECT count(*) INTO v_canonical_subs
  FROM public.subscriptions_v2 WHERE order_id = v_canonical_id AND id <> v_sub_id;
  IF v_canonical_subs > 0 THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: canonical % already has % other subs', v_canonical_id, v_canonical_subs;
  END IF;

  v_before := jsonb_build_object(
    'sub_id', v_sub.id,
    'sub_order_id_before', v_sub.order_id,
    'sub_status', v_sub.status,
    'old_order_id', v_old_order_id,
    'canonical_order_id', v_canonical_id
  );

  UPDATE public.subscriptions_v2
  SET order_id = v_canonical_id,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'repair_2026_05', jsonb_build_object(
          'action', 'relink_to_canonical_order',
          'previous_order_id', v_old_order_id,
          'canonical_order_id', v_canonical_id,
          'reason', 'bepaid_uid_collision_legacy_duplicate cleanup'
        )
      )
  WHERE id = v_sub_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'CASE_1_2_ABORT: rowcount=% expected 1', v_rowcount;
  END IF;

  SELECT jsonb_build_object('sub_order_id_after', order_id)
    INTO v_after FROM public.subscriptions_v2 WHERE id = v_sub_id;

  INSERT INTO public.audit_logs(action, meta)
  VALUES ('subscriptions.repair_relink_canonical_order_2026_05',
          jsonb_build_object('case','1.2','before',v_before,'after',v_after));

  RAISE NOTICE 'CASE_1_2_OK: sub % relinked % -> %', v_sub_id, v_old_order_id, v_canonical_id;
END$$;

-- CASE 1.3
DO $$
DECLARE
  v_order_id uuid;
  v_order    record;
  v_payments int;
  v_subs     int;
  v_ledger   int;
  v_rowcount int;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  SELECT id INTO v_order_id FROM public.orders_v2 WHERE id::text LIKE '02302928-%' LIMIT 1;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'CASE_1_3_ABORT: order 02302928 not found';
  END IF;

  SELECT * INTO v_order FROM public.orders_v2 WHERE id = v_order_id FOR UPDATE;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'CASE_1_3_ABORT: order.status=% expected paid', v_order.status;
  END IF;

  SELECT count(*) INTO v_payments FROM public.payments_v2        WHERE order_id = v_order_id;
  SELECT count(*) INTO v_subs     FROM public.subscriptions_v2   WHERE order_id = v_order_id;
  SELECT count(*) INTO v_ledger   FROM public.access_grant_ledger
    WHERE order_id = v_order_id OR source_order_id = v_order_id;

  IF v_payments <> 0 OR v_subs <> 0 OR v_ledger <> 0 THEN
    RAISE EXCEPTION 'CASE_1_3_ABORT: not clean payments=% subs=% ledger=%',
      v_payments, v_subs, v_ledger;
  END IF;

  v_before := jsonb_build_object(
    'order_id', v_order.id,
    'status_before', v_order.status,
    'meta_repair_reason', v_order.meta->>'repair_reason'
  );

  UPDATE public.orders_v2
  SET status = 'canceled',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'repair_2026_05', jsonb_build_object(
          'action', 'status_correction_paid_to_canceled',
          'previous_status', 'paid',
          'reason', '3ds_redirect_reconciled_no_payment'
        )
      )
  WHERE id = v_order_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'CASE_1_3_ABORT: rowcount=% expected 1', v_rowcount;
  END IF;

  SELECT jsonb_build_object('status_after', status)
    INTO v_after FROM public.orders_v2 WHERE id = v_order_id;

  INSERT INTO public.audit_logs(action, meta)
  VALUES ('orders.repair_status_correction_2026_05',
          jsonb_build_object('case','1.3','before',v_before,'after',v_after));

  RAISE NOTICE 'CASE_1_3_OK: order % canceled', v_order_id;
END$$;
