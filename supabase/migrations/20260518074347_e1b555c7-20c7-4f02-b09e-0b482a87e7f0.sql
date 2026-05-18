-- PATCH-RB3: financial repair for Case A (live-fail of PATCH-RB1.1 runtime watch).
-- Rebinds payments_v2.f2892a00 from parent (91b98bf3) to REBILL-order (06f22ceb).
-- Access NOT touched — already extended canonically to 2026-06-17 12:00:00Z by RB1.1 first grant.
-- Guarded by pre/post asserts; no-op + RAISE if state has drifted.

DO $$
DECLARE
  v_payment_id  uuid := 'f2892a00-5731-4adb-97d8-ff8d3472f953';
  v_parent_id   uuid := '91b98bf3-282a-4ef0-854d-f71a86577139';
  v_rebill_id   uuid := '06f22ceb-9792-464e-adfb-d15519352d21';
  v_provider_uid text := '111dfc17-80c2-477c-8ecd-9b768744e8b7';
  v_current_order uuid;
  v_affected int;
BEGIN
  -- Pre-check: payment exists and is on parent
  SELECT order_id INTO v_current_order
  FROM payments_v2
  WHERE id = v_payment_id AND provider = 'bepaid' AND provider_payment_id = v_provider_uid;

  IF v_current_order IS NULL THEN
    RAISE EXCEPTION 'PATCH-RB3 abort: payment % not found by id+provider+uid', v_payment_id;
  END IF;

  IF v_current_order = v_rebill_id THEN
    RAISE NOTICE 'PATCH-RB3 noop: payment % already on REBILL %', v_payment_id, v_rebill_id;
    RETURN;
  END IF;

  IF v_current_order <> v_parent_id THEN
    RAISE EXCEPTION 'PATCH-RB3 abort: payment.order_id=% is neither parent % nor rebill %',
      v_current_order, v_parent_id, v_rebill_id;
  END IF;

  -- Confirm REBILL order exists with the expected shape
  IF NOT EXISTS (
    SELECT 1 FROM orders_v2
    WHERE id = v_rebill_id
      AND order_number = 'REBILL-111dfc17-80c'
      AND status = 'paid'
      AND base_price = 250.00
  ) THEN
    RAISE EXCEPTION 'PATCH-RB3 abort: REBILL-order % missing or mismatched', v_rebill_id;
  END IF;

  -- Apply rebind
  UPDATE payments_v2
  SET order_id = v_rebill_id,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'patch_rb3_rebind', jsonb_build_object(
          'from_order_id', v_parent_id,
          'to_order_id', v_rebill_id,
          'reason', 'rb1_1_legacy_step_e_overwrote_to_parent',
          'at', now()
        )
      )
  WHERE id = v_payment_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'PATCH-RB3 abort: rebind UPDATE affected % rows (expected 1)', v_affected;
  END IF;

  -- Post-check
  SELECT order_id INTO v_current_order FROM payments_v2 WHERE id = v_payment_id;
  IF v_current_order <> v_rebill_id THEN
    RAISE EXCEPTION 'PATCH-RB3 abort: post-check failed, payment.order_id=% expected %',
      v_current_order, v_rebill_id;
  END IF;

  -- Audit
  INSERT INTO audit_logs (actor_type, actor_label, action, meta, created_at)
  VALUES (
    'system',
    'patch_rb3',
    'bepaid.rebill.payment_rebind_repaired',
    jsonb_build_object(
      'payment_id', v_payment_id,
      'provider_payment_id', v_provider_uid,
      'from_order_id', v_parent_id,
      'to_order_id', v_rebill_id,
      'reason', 'rb1_1_legacy_step_e_overwrote_to_parent',
      'case_label', 'case_a_live_fail_runtime_watch',
      'grant_invoked', false,
      'access_unchanged_until', '2026-06-17T12:00:00Z'
    ),
    now()
  );

  RAISE NOTICE 'PATCH-RB3 done: payment % rebound to REBILL %', v_payment_id, v_rebill_id;
END $$;