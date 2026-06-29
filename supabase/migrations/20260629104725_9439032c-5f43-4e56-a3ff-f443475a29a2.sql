DO $$
DECLARE
  v_order_id uuid := 'dd7a52a1-cfb7-4269-ad21-41349a82abef';
  v_sub_id uuid := '16a8b56c-9e87-4a12-a46d-93646e834b9d';
  v_user_id uuid := '05cd3754-d589-4d90-97d1-89ba2bee610b';
  v_product_id uuid := '3ea08f79-afe8-4361-81fe-4c0f318f9a2b';
  v_tariff_id uuid := '85863b4b-c5e4-4f43-884d-2bdbe48d3914';
  v_ent_id uuid := '87aa1817-6a21-44e5-8d3a-18ccfefaa50d';
  v_provider_count int;
BEGIN
  -- Safety: must be 0 provider subs
  SELECT count(*) INTO v_provider_count FROM provider_subscriptions
    WHERE order_id = v_order_id OR subscription_v2_id = v_sub_id;
  IF v_provider_count <> 0 THEN
    RAISE EXCEPTION 'Aborting: provider_subscriptions linked (%).', v_provider_count;
  END IF;

  -- Verify target order is the trial no-card test deal
  PERFORM 1 FROM orders_v2
    WHERE id = v_order_id
      AND user_id = v_user_id
      AND product_id = v_product_id
      AND tariff_id = v_tariff_id
      AND is_trial = true
      AND paid_amount = 0
      AND status = 'paid'
      AND meta->>'source' = 'trial_no_card';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aborting: target order does not match trial_no_card safety filter.';
  END IF;

  -- Delete dependent rows
  DELETE FROM access_grant_ledger WHERE order_id = v_order_id;
  DELETE FROM entitlement_orders WHERE order_id = v_order_id;
  DELETE FROM entitlements WHERE id = v_ent_id AND user_id = v_user_id AND product_id = v_product_id;
  DELETE FROM audit_logs
    WHERE meta->>'order_id' = v_order_id::text
       OR meta->>'subscription_id' = v_sub_id::text;
  DELETE FROM subscriptions_v2
    WHERE id = v_sub_id
      AND order_id = v_order_id
      AND user_id = v_user_id
      AND tariff_id = v_tariff_id
      AND auto_renew = false;
  DELETE FROM orders_v2
    WHERE id = v_order_id
      AND user_id = v_user_id
      AND is_trial = true
      AND paid_amount = 0
      AND meta->>'source' = 'trial_no_card';
END $$;