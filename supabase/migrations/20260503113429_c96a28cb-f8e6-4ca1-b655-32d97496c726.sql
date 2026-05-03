DO $$
DECLARE
  v_backup_count int;
  v_deleted_count int;
  v_audit_count int;
BEGIN
  -- 1. Создать backup-таблицу
  CREATE TABLE IF NOT EXISTS public._orders_orphan_cleanup_2026_05_backup (
    id uuid PRIMARY KEY,
    order_number text,
    product_id uuid,
    status text,
    final_price numeric,
    profile_id uuid,
    user_id uuid,
    customer_email text,
    created_at timestamptz,
    meta jsonb,
    snapshot jsonb,
    backed_up_at timestamptz NOT NULL DEFAULT now()
  );

  -- 2. Снять snapshot ровно по тем же критериям (Cohort A, 572 строки)
  WITH ignored_actions AS (
    SELECT unnest(ARRAY[
      'system.payment_link.created',
      'payment_checkout.token_expired',
      'crm_routing_snapshot_negative',
      'system.payment_link.viewed',
      'system.payment_link.opened'
    ]) AS action
  ),
  target_products AS (
    SELECT unnest(ARRAY[
      '11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid,
      '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid
    ]) AS product_id
  ),
  candidates AS (
    SELECT o.*
    FROM orders_v2 o
    WHERE o.product_id IN (SELECT product_id FROM target_products)
      AND o.status IN ('pending','failed','canceled')
      AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM subscriptions_v2 s WHERE s.order_id = o.id OR (s.meta->>'origin_order_id')::text = o.id::text)
      AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE (e.meta->>'order_id')::text = o.id::text OR (e.meta->>'source_order_id')::text = o.id::text OR e.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM access_grant_ledger l WHERE l.order_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE (a.meta->>'order_id')::text = o.id::text
          AND a.action NOT IN (SELECT action FROM ignored_actions)
          AND (
            a.action ILIKE 'grant%' OR a.action ILIKE '%access%' OR a.action ILIKE '%entitlement%'
            OR a.action ILIKE '%subscription%' OR a.action ILIKE '%fulfillment%' OR a.action ILIKE '%revoke%'
            OR a.action ILIKE '%payment%paid%' OR a.action ILIKE '%order%paid%'
            OR a.action ILIKE 'admin.create_deal%' OR a.action ILIKE '%bepaid%checkout%'
          )
      )
  )
  INSERT INTO public._orders_orphan_cleanup_2026_05_backup
    (id, order_number, product_id, status, final_price, profile_id, user_id, customer_email, created_at, meta, snapshot)
  SELECT c.id, c.order_number, c.product_id, c.status, c.final_price, c.profile_id, c.user_id, c.customer_email, c.created_at, c.meta, to_jsonb(c)
  FROM candidates c
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_backup_count FROM public._orders_orphan_cleanup_2026_05_backup;

  IF v_backup_count <> 572 THEN
    RAISE EXCEPTION 'Backup count mismatch: expected 572, got %', v_backup_count;
  END IF;

  -- 3. Записать audit на каждую удаляемую строку
  INSERT INTO audit_logs (action, meta, created_at)
  SELECT
    'orders.cohort_a_orphan_delete_2026_05',
    jsonb_build_object(
      'order_id', b.id,
      'order_number', b.order_number,
      'product_id', b.product_id,
      'status', b.status,
      'profile_id', b.profile_id,
      'user_id', b.user_id,
      'customer_email', b.customer_email,
      'created_at', b.created_at,
      'reason', 'orphan_no_payments_no_refs',
      'cohort', 'A',
      'batch', '2026_05_orphan_cleanup'
    ),
    now()
  FROM public._orders_orphan_cleanup_2026_05_backup b;

  GET DIAGNOSTICS v_audit_count = ROW_COUNT;
  IF v_audit_count <> 572 THEN
    RAISE EXCEPTION 'Audit count mismatch: expected 572, got %', v_audit_count;
  END IF;

  -- 4. Удалить ровно те id, что в backup
  DELETE FROM orders_v2 o
  USING public._orders_orphan_cleanup_2026_05_backup b
  WHERE o.id = b.id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count <> 572 THEN
    RAISE EXCEPTION 'Delete count mismatch: expected 572, got %', v_deleted_count;
  END IF;

  RAISE NOTICE 'OK: backup=%, audit=%, deleted=%', v_backup_count, v_audit_count, v_deleted_count;
END$$;