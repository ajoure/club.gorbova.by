
DO $$
DECLARE
  k_order uuid := 'b464dc75-f295-419d-bede-10cd47fc299e';
  k_pay   uuid := '2d40bc7e-e69f-4633-88d5-102561e49a54';
  k_sub   uuid := '6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a';
  k_ent   uuid := 'fabd7e5a-95b1-4bc3-89ad-a635f8ee8edc';
  c int;
BEGIN
  -- Build working sets as temp tables
  CREATE TEMP TABLE _t_orders ON COMMIT DROP AS
    SELECT id FROM orders_v2
    WHERE (meta::text ILIKE '%stripe%' OR provider='stripe')
      AND id <> k_order;

  CREATE TEMP TABLE _t_subs ON COMMIT DROP AS
    SELECT id FROM subscriptions_v2 WHERE meta::text ILIKE '%stripe%'
    UNION
    SELECT id FROM subscriptions_v2 WHERE order_id IN (SELECT id FROM _t_orders);

  CREATE TEMP TABLE _t_pays ON COMMIT DROP AS
    SELECT id FROM payments_v2
    WHERE (meta::text ILIKE '%stripe%' OR provider='stripe')
      AND id <> k_pay;

  -- KEEP-guards
  IF EXISTS (SELECT 1 FROM _t_orders WHERE id = k_order) THEN RAISE EXCEPTION 'KEEP order in delete set'; END IF;
  IF EXISTS (SELECT 1 FROM _t_subs   WHERE id = k_sub  ) THEN RAISE EXCEPTION 'KEEP sub in delete set'; END IF;
  IF EXISTS (SELECT 1 FROM _t_pays   WHERE id = k_pay  ) THEN RAISE EXCEPTION 'KEEP payment in delete set'; END IF;

  -- Count asserts
  SELECT count(*) INTO c FROM _t_orders; IF c <> 31 THEN RAISE EXCEPTION 'orders count % expected 31', c; END IF;
  SELECT count(*) INTO c FROM _t_subs;   IF c <> 25 THEN RAISE EXCEPTION 'subs count % expected 25', c; END IF;
  SELECT count(*) INTO c FROM _t_pays;   IF c <> 22 THEN RAISE EXCEPTION 'payments count % expected 22', c; END IF;

  -- BACKUPS (drop if leftover from rolled-back attempt)
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_orders;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_payments;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_subscriptions;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_provider_subs;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_entitlements;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_access_grant_ledger;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_payment_links;
  DROP TABLE IF EXISTS _stripe_cleanup_2026_06_backup_provider_events;

  CREATE TABLE _stripe_cleanup_2026_06_backup_orders AS
    SELECT * FROM orders_v2 WHERE id IN (SELECT id FROM _t_orders);
  CREATE TABLE _stripe_cleanup_2026_06_backup_payments AS
    SELECT * FROM payments_v2 WHERE id IN (SELECT id FROM _t_pays);
  CREATE TABLE _stripe_cleanup_2026_06_backup_subscriptions AS
    SELECT * FROM subscriptions_v2 WHERE id IN (SELECT id FROM _t_subs);
  CREATE TABLE _stripe_cleanup_2026_06_backup_provider_subs AS
    SELECT * FROM provider_subscriptions WHERE subscription_v2_id IN (SELECT id FROM _t_subs);
  CREATE TABLE _stripe_cleanup_2026_06_backup_entitlements AS
    SELECT * FROM entitlements WHERE order_id IN (SELECT id FROM _t_orders);
  CREATE TABLE _stripe_cleanup_2026_06_backup_access_grant_ledger AS
    SELECT * FROM access_grant_ledger WHERE order_id IN (SELECT id FROM _t_orders);
  CREATE TABLE _stripe_cleanup_2026_06_backup_payment_links AS
    SELECT * FROM payment_links WHERE provider='stripe';
  CREATE TABLE _stripe_cleanup_2026_06_backup_provider_events AS
    SELECT * FROM provider_events
    WHERE provider='stripe' AND (related_payment_id IS NULL OR related_payment_id <> k_pay);

  -- DELETE in FK-safe order
  DELETE FROM access_grant_ledger WHERE order_id IN (SELECT id FROM _t_orders);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 11 THEN RAISE EXCEPTION 'agl deleted % expected 11', c; END IF;

  DELETE FROM entitlements WHERE order_id IN (SELECT id FROM _t_orders);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 5 THEN RAISE EXCEPTION 'entitlements deleted % expected 5', c; END IF;

  DELETE FROM provider_subscriptions WHERE subscription_v2_id IN (SELECT id FROM _t_subs);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 16 THEN RAISE EXCEPTION 'provider_subs deleted % expected 16', c; END IF;

  DELETE FROM subscriptions_v2 WHERE id IN (SELECT id FROM _t_subs);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 25 THEN RAISE EXCEPTION 'subs deleted % expected 25', c; END IF;

  DELETE FROM payment_links WHERE provider='stripe';
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 13 THEN RAISE EXCEPTION 'payment_links deleted % expected 13', c; END IF;

  DELETE FROM provider_events
    WHERE provider='stripe' AND (related_payment_id IS NULL OR related_payment_id <> k_pay);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 122 THEN RAISE EXCEPTION 'provider_events deleted % expected 122', c; END IF;

  DELETE FROM payments_v2 WHERE id IN (SELECT id FROM _t_pays);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 22 THEN RAISE EXCEPTION 'payments deleted % expected 22', c; END IF;

  DELETE FROM orders_v2 WHERE id IN (SELECT id FROM _t_orders);
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 31 THEN RAISE EXCEPTION 'orders deleted % expected 31', c; END IF;

  -- Post-verify KEEP intact
  IF NOT EXISTS (SELECT 1 FROM orders_v2       WHERE id = k_order) THEN RAISE EXCEPTION 'KEEP order missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM payments_v2     WHERE id = k_pay  ) THEN RAISE EXCEPTION 'KEEP payment missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM subscriptions_v2 WHERE id = k_sub ) THEN RAISE EXCEPTION 'KEEP sub missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM entitlements    WHERE id = k_ent  ) THEN RAISE EXCEPTION 'KEEP entitlement missing'; END IF;

  -- No stray live-stripe residue
  IF EXISTS (SELECT 1 FROM orders_v2 WHERE meta::text ILIKE '%cs_live_%' AND id <> k_order) THEN
    RAISE EXCEPTION 'unexpected cs_live order remaining';
  END IF;
  IF EXISTS (SELECT 1 FROM payments_v2 WHERE provider='stripe' AND id <> k_pay) THEN
    RAISE EXCEPTION 'stripe payments residue';
  END IF;
END $$;
