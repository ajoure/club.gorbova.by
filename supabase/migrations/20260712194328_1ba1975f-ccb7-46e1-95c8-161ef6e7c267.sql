
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '496ed05b-9918-4142-9d38-9778ede52153'::uuid,
    '9b412ac6-690c-430b-8ce8-71afa057ac78'::uuid,
    '9e158f4b-af9b-4699-823c-61ebc8f2e361'::uuid,
    'ce8eedad-eb2e-46f2-a424-3e22f117bd99'::uuid
  ];
  v_row RECORD;
  v_bepaid_uid text;
  v_q_amount numeric;
  v_q_currency text;
  v_q_paid_at timestamptz;
  v_collision int;
  v_updated int := 0;
  v_uniq_count int;
  v_remaining_admin int;
  v_now timestamptz := now();
BEGIN
  IF array_length(v_ids,1) <> 4 THEN
    RAISE EXCEPTION 'A2-0: expected 4 IDs, got %', array_length(v_ids,1);
  END IF;

  FOR v_row IN
    SELECT * FROM payments_v2
    WHERE id = ANY(v_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_row.provider <> 'admin' THEN
      RAISE EXCEPTION 'A2-0: payment % provider=% expected admin', v_row.id, v_row.provider;
    END IF;
    IF v_row.origin IS DISTINCT FROM 'bepaid' THEN
      RAISE EXCEPTION 'A2-0: payment % origin=% expected bepaid', v_row.id, v_row.origin;
    END IF;
    IF v_row.is_deleted THEN
      RAISE EXCEPTION 'A2-0: payment % is soft-deleted', v_row.id;
    END IF;
    IF v_row.provider_payment_id IS NOT NULL AND v_row.provider_payment_id <> '' THEN
      RAISE EXCEPTION 'A2-0: payment % already has provider_payment_id=%', v_row.id, v_row.provider_payment_id;
    END IF;
    IF (v_row.meta->>'queue_payment_id') IS NULL THEN
      RAISE EXCEPTION 'A2-0: payment % missing meta.queue_payment_id', v_row.id;
    END IF;

    SELECT bepaid_uid, amount, currency, paid_at
      INTO v_bepaid_uid, v_q_amount, v_q_currency, v_q_paid_at
    FROM (
      SELECT bepaid_uid, amount, currency, paid_at
      FROM payment_reconcile_queue
      WHERE id = (v_row.meta->>'queue_payment_id')::uuid
      UNION ALL
      SELECT bepaid_uid, amount, currency, paid_at
      FROM payment_reconcile_queue_archive
      WHERE id = (v_row.meta->>'queue_payment_id')::uuid
    ) q
    LIMIT 1;

    IF v_bepaid_uid IS NULL THEN
      RAISE EXCEPTION 'A2-0: payment % queue row not found or has no bepaid_uid', v_row.id;
    END IF;

    IF v_row.amount <> v_q_amount THEN
      RAISE EXCEPTION 'A2-0: payment % amount mismatch pay=% queue=%', v_row.id, v_row.amount, v_q_amount;
    END IF;
    IF v_row.currency IS DISTINCT FROM v_q_currency THEN
      RAISE EXCEPTION 'A2-0: payment % currency mismatch pay=% queue=%', v_row.id, v_row.currency, v_q_currency;
    END IF;
    IF v_row.paid_at IS DISTINCT FROM v_q_paid_at THEN
      RAISE EXCEPTION 'A2-0: payment % paid_at mismatch pay=% queue=%', v_row.id, v_row.paid_at, v_q_paid_at;
    END IF;

    SELECT count(*) INTO v_collision
    FROM payments_v2
    WHERE provider_payment_id = v_bepaid_uid
      AND id <> v_row.id;
    IF v_collision > 0 THEN
      RAISE EXCEPTION 'A2-0: bepaid_uid % already exists in payments_v2 (payment %)', v_bepaid_uid, v_row.id;
    END IF;

    UPDATE payments_v2
    SET provider = 'bepaid',
        provider_payment_id = v_bepaid_uid,
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'legacy_provider', 'admin',
          'provider_backfill_source', 'payment_reconcile_queue',
          'provider_backfilled_at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'provider_backfill_patch', 'PATCH-PAYMENTS-MANAGEMENT-V2-A2-0'
        ),
        updated_at = v_now
    WHERE id = v_row.id;

    v_updated := v_updated + 1;

    INSERT INTO audit_logs(action, actor_type, actor_label, entity_type, entity_id, target_user_id, meta, created_at)
    VALUES (
      'admin.payment.provider_backfilled',
      'system',
      'PATCH-PAYMENTS-MANAGEMENT-V2-A2-0',
      'payments_v2',
      v_row.id::text,
      v_row.profile_id,
      jsonb_build_object(
        'patch', 'PATCH-PAYMENTS-MANAGEMENT-V2-A2-0',
        'legacy_provider', 'admin',
        'new_provider', 'bepaid',
        'bepaid_uid', v_bepaid_uid,
        'queue_payment_id', v_row.meta->>'queue_payment_id',
        'order_id', v_row.order_id,
        'amount', v_row.amount,
        'currency', v_row.currency,
        'paid_at', v_row.paid_at
      ),
      v_now
    );
  END LOOP;

  IF v_updated <> 4 THEN
    RAISE EXCEPTION 'A2-0: expected 4 updates, got %', v_updated;
  END IF;

  SELECT count(DISTINCT provider_payment_id) INTO v_uniq_count
  FROM payments_v2 WHERE id = ANY(v_ids);
  IF v_uniq_count <> 4 THEN
    RAISE EXCEPTION 'A2-0 post-check: expected 4 unique provider_payment_id, got %', v_uniq_count;
  END IF;

  SELECT count(*) INTO v_remaining_admin
  FROM payments_v2
  WHERE provider = 'admin' AND amount > 0 AND is_deleted = false;
  IF v_remaining_admin <> 113 THEN
    RAISE EXCEPTION 'A2-0 post-check: expected 113 remaining admin amount>0, got %', v_remaining_admin;
  END IF;

  RAISE NOTICE 'A2-0 OK: 4 rows backfilled, remaining admin amount>0 = %', v_remaining_admin;
END $$;
