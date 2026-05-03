-- Canonical rebill repair for Elena Shirshova (a25168db) — single row backfill.
-- Target end: 2026-06-02 23:59:59 Europe/Minsk (= 2026-06-02 20:59:59+00).
-- Logic mirrors bepaid-webhook INLINE block (Fix-2 path), GREATEST defended.

DO $$
DECLARE
  v_sub_id      uuid := 'a25168db-a289-431a-8869-5fca9486ca62';
  v_ent_id      uuid := '57525f51-8b87-4287-82e4-8d703c89ad96';
  v_user_id     uuid := '1409fd0e-23fb-44fb-a6af-11778a53a94f';
  v_order_id    uuid := '2e0b6eaa-da53-4f9c-98fb-2a1bb2d366b4';
  v_payment_id  uuid := '0e713a34-9e7f-42fb-be8f-9861fbbf3bd8';
  v_target_end  timestamptz := '2026-06-02 20:59:59+00';
  v_old_sub_end timestamptz;
  v_old_ent_end timestamptz;
  v_old_ta_end  timestamptz;
  v_existing    int;
BEGIN
  -- Idempotency guard: don't double-backfill
  SELECT count(*) INTO v_existing
  FROM audit_logs
  WHERE action='rebill_backfill_2026_05.fixed'
    AND meta->>'subscription_id' = v_sub_id::text;
  IF v_existing > 0 THEN
    RAISE NOTICE 'Already backfilled, skipping';
    RETURN;
  END IF;

  SELECT access_end_at INTO v_old_sub_end FROM subscriptions_v2 WHERE id=v_sub_id;
  SELECT expires_at    INTO v_old_ent_end FROM entitlements    WHERE id=v_ent_id;
  SELECT active_until  INTO v_old_ta_end  FROM telegram_access WHERE user_id=v_user_id AND club_id='fa547c41-3a84-4c4f-904a-427332a0506e';

  -- 1) subscriptions_v2: GREATEST + status=active, align next_charge_at, billing_type=provider_managed.
  UPDATE subscriptions_v2 s
  SET status='active',
      access_end_at = GREATEST(s.access_end_at, v_target_end),
      next_charge_at = GREATEST(s.next_charge_at, v_target_end),
      billing_type='provider_managed',
      auto_renew=true,
      meta = COALESCE(s.meta,'{}'::jsonb) || jsonb_build_object(
        'bepaid_subscription_id','sbs_f018657539d76377',
        'bepaid_activated_at', now(),
        'rebill_backfill_2026_05', jsonb_build_object(
          'payment_id', v_payment_id::text,
          'old_access_end_at', v_old_sub_end,
          'fixed_at', now()
        )
      )
  WHERE s.id = v_sub_id;

  -- 2) entitlements: GREATEST
  UPDATE entitlements e
  SET expires_at = GREATEST(e.expires_at, v_target_end),
      status='active',
      updated_at=now(),
      meta = COALESCE(e.meta,'{}'::jsonb) || jsonb_build_object(
        'rebill_backfill_2026_05', jsonb_build_object(
          'payment_id', v_payment_id::text,
          'old_expires_at', v_old_ent_end,
          'fixed_at', now()
        )
      )
  WHERE e.id = v_ent_id;

  -- 3) telegram_access: GREATEST for club bound to product via access_rules
  UPDATE telegram_access ta
  SET active_until = GREATEST(ta.active_until, v_target_end),
      updated_at = now()
  WHERE ta.user_id = v_user_id
    AND ta.club_id = 'fa547c41-3a84-4c4f-904a-427332a0506e';

  -- 4) Audit
  INSERT INTO audit_logs(actor_type, actor_label, action, target_user_id, meta)
  VALUES (
    'system',
    'rebill_backfill_2026_05',
    'rebill_backfill_2026_05.fixed',
    v_user_id,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'order_id', v_order_id,
      'subscription_id', v_sub_id,
      'entitlement_id', v_ent_id,
      'old_access_end', v_old_sub_end,
      'old_entitlement_expires_at', v_old_ent_end,
      'old_telegram_active_until', v_old_ta_end,
      'new_access_end', v_target_end,
      'proof_source', 'calcCalendarMonthEnd(prev_end=2026-05-02T12:00:00Z) -> endOfDayAppTz(Europe/Minsk)',
      'rule', 'calendar_month + EOD Minsk',
      'paid_at', '2026-05-02T13:15:27.673+00:00',
      'invariant', 'access ends 23:59:59 Europe/Minsk on planned next-charge day'
    )
  );
END $$;