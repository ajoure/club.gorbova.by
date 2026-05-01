
-- =====================================================================================
-- REBILL ORDERS MATERIALIZATION 2026
-- Run: rebill_orders_materialization_2026
-- =====================================================================================
DO $migration$
DECLARE
  v_run text := 'rebill_orders_materialization_2026';
  v_pre_subs_rows bigint;
  v_pre_subs_sum bigint;
  v_pre_ent_rows bigint;
  v_pre_ent_sum bigint;
  v_post_subs_rows bigint;
  v_post_subs_sum bigint;
  v_post_ent_rows bigint;
  v_post_ent_sum bigint;
  v_inserted int;
  v_repointed int;
  v_distinct_parents int;
  v_distinct_users int;
  v_sum_amount numeric;
  v_orphans int;
BEGIN
  ----------------------------------------------------------------------------
  -- 0. PRE-STATE контрольные суммы (по 112 пользователям из аудита)
  ----------------------------------------------------------------------------
  WITH ords AS (
    SELECT o.id AS order_id FROM orders_v2 o
    WHERE o.product_id IN ('11c9f1b8-0355-4753-bd74-40b42aa53616','85046734-2282-4ded-b0d3-8c66c8f5bc2b')
      AND o.created_at >= '2026-01-01' AND o.created_at < '2027-01-01'
      AND o.status='paid' AND COALESCE(o.meta->>'source','') <> 'rule_engine'
  ),
  ranked AS (
    SELECT pv.user_id, pv.order_id, pv.paid_at,
      row_number() OVER (PARTITION BY pv.order_id ORDER BY pv.paid_at, pv.id) AS rn
    FROM payments_v2 pv
    WHERE pv.status='succeeded' AND pv.order_id IN (SELECT order_id FROM ords)
      AND pv.paid_at >= '2026-01-01' AND pv.paid_at < '2027-01-01'
  ),
  scope_users AS (
    SELECT DISTINCT user_id FROM ranked WHERE rn>1
  )
  SELECT
    (SELECT COUNT(*) FROM subscriptions_v2 s WHERE s.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM s.access_end_at)::bigint),0) FROM subscriptions_v2 s WHERE s.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COUNT(*) FROM entitlements e WHERE e.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.expires_at)::bigint),0) FROM entitlements e WHERE e.user_id IN (SELECT user_id FROM scope_users))
  INTO v_pre_subs_rows, v_pre_subs_sum, v_pre_ent_rows, v_pre_ent_sum;

  RAISE NOTICE 'PRE-STATE: subs_rows=% subs_sum=% ent_rows=% ent_sum=%',
    v_pre_subs_rows, v_pre_subs_sum, v_pre_ent_rows, v_pre_ent_sum;

  ----------------------------------------------------------------------------
  -- 1. Подготовка кандидатов в temp-таблице
  ----------------------------------------------------------------------------
  CREATE TEMP TABLE _rebill_candidates ON COMMIT DROP AS
  WITH ords AS (
    SELECT o.id AS parent_order_id, o.product_id, o.tariff_id, o.user_id, o.profile_id,
           o.meta AS parent_meta, o.meta->>'deal_month' AS parent_deal_month,
           o.bepaid_subscription_id, o.pipeline_id, o.pipeline_stage_id,
           o.order_number AS parent_order_number, o.currency
    FROM orders_v2 o
    WHERE o.product_id IN ('11c9f1b8-0355-4753-bd74-40b42aa53616','85046734-2282-4ded-b0d3-8c66c8f5bc2b')
      AND o.created_at >= '2026-01-01' AND o.created_at < '2027-01-01'
      AND o.status='paid' AND COALESCE(o.meta->>'source','') <> 'rule_engine'
  ),
  ranked AS (
    SELECT pv.id AS payment_id, pv.order_id, pv.amount, pv.paid_at,
           pv.provider AS pay_provider, pv.provider_payment_id AS pay_provider_payment_id,
           pv.user_id, pv.profile_id, pv.currency,
           row_number() OVER (PARTITION BY pv.order_id ORDER BY pv.paid_at, pv.id) AS rn
    FROM payments_v2 pv
    WHERE pv.status='succeeded' AND pv.order_id IN (SELECT parent_order_id FROM ords)
      AND pv.paid_at >= '2026-01-01' AND pv.paid_at < '2027-01-01'
  ),
  cand AS (
    SELECT r.payment_id, r.order_id AS parent_order_id, r.amount, r.paid_at,
           r.pay_provider, r.pay_provider_payment_id,
           r.user_id, r.profile_id, r.currency,
           to_char((r.paid_at AT TIME ZONE 'Europe/Minsk'),'YYYY-MM') AS deal_month,
           o.product_id, o.tariff_id, o.parent_deal_month,
           o.bepaid_subscription_id, o.pipeline_id, o.pipeline_stage_id, o.parent_order_number,
           o.parent_meta
    FROM ranked r JOIN ords o ON o.parent_order_id=r.order_id
    WHERE r.rn > 1
  )
  SELECT c.*, gen_random_uuid() AS new_order_id
  FROM cand c
  WHERE NOT EXISTS (
    SELECT 1 FROM orders_v2 o2 WHERE (o2.meta->>'materialized_from_payment_id') = c.payment_id::text
  )
  AND NOT (
    c.pay_provider_payment_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM orders_v2 o3
      WHERE o3.provider='bepaid' AND o3.provider_payment_id = c.pay_provider_payment_id
        AND o3.id <> c.parent_order_id
    )
  );

  ----------------------------------------------------------------------------
  -- 2. PRE-CHECK инварианты
  ----------------------------------------------------------------------------
  IF (SELECT COUNT(*) FROM _rebill_candidates) <> 200 THEN
    RAISE EXCEPTION 'INVARIANT FAIL: expected 200 candidates, got %', (SELECT COUNT(*) FROM _rebill_candidates);
  END IF;
  IF EXISTS (SELECT 1 FROM _rebill_candidates WHERE deal_month IS NULL OR deal_month !~ '^[0-9]{4}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'INVARIANT FAIL: bad deal_month';
  END IF;
  IF EXISTS (SELECT 1 FROM _rebill_candidates WHERE pipeline_id IS NULL OR pipeline_stage_id IS NULL) THEN
    RAISE EXCEPTION 'INVARIANT FAIL: missing pipeline/stage';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _rebill_candidates WHERE tariff_id NOT IN (
      SELECT DISTINCT tariff_id FROM _rebill_candidates
    )
  ) THEN
    RAISE EXCEPTION 'INVARIANT FAIL: tariff scope drift';
  END IF;
  IF EXISTS (
    SELECT pay_provider_payment_id FROM _rebill_candidates
    WHERE pay_provider_payment_id IS NOT NULL
    GROUP BY pay_provider_payment_id HAVING COUNT(*)>1
  ) THEN
    RAISE EXCEPTION 'INVARIANT FAIL: duplicate provider_payment_id within candidates';
  END IF;

  ----------------------------------------------------------------------------
  -- 3. INSERT child orders
  ----------------------------------------------------------------------------
  INSERT INTO orders_v2 (
    id, order_number, user_id, profile_id, product_id, tariff_id, currency,
    status, final_price, paid_amount, base_price,
    provider, provider_payment_id, bepaid_subscription_id,
    created_at, updated_at, deal_date,
    pipeline_id, pipeline_stage_id, meta
  )
  SELECT
    c.new_order_id,
    'REBILL-' || substr(c.payment_id::text, 1, 12),
    c.user_id, c.profile_id, c.product_id, c.tariff_id, COALESCE(c.currency,'BYN'),
    'paid', c.amount, c.amount, c.amount,
    c.pay_provider, c.pay_provider_payment_id, c.bepaid_subscription_id,
    c.paid_at, now(), c.paid_at,
    c.pipeline_id, c.pipeline_stage_id,
    jsonb_build_object(
      'deal_month', c.deal_month,
      'payment_flow', 'bepaid_subscription_charge',
      'source', 'rebill_materialization',
      'parent_order_id', c.parent_order_id,
      'materialized_from_payment_id', c.payment_id,
      'original_parent_deal_month', c.parent_deal_month,
      'do_not_grant_access', true,
      'materialization_run', v_run
    )
  FROM _rebill_candidates c;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'INSERTED child orders: %', v_inserted;

  ----------------------------------------------------------------------------
  -- 4. UPDATE payments_v2.order_id → новый child order
  ----------------------------------------------------------------------------
  UPDATE payments_v2 pv
  SET order_id = c.new_order_id, updated_at = now()
  FROM _rebill_candidates c
  WHERE pv.id = c.payment_id;

  GET DIAGNOSTICS v_repointed = ROW_COUNT;
  RAISE NOTICE 'REPOINTED payments: %', v_repointed;

  IF v_inserted <> v_repointed THEN
    RAISE EXCEPTION 'INVARIANT FAIL: inserted (%) <> repointed (%)', v_inserted, v_repointed;
  END IF;
  IF v_inserted <> 200 THEN
    RAISE EXCEPTION 'INVARIANT FAIL: expected 200 inserts, got %', v_inserted;
  END IF;

  ----------------------------------------------------------------------------
  -- 5. POST-STATE контрольные суммы — должны совпасть с PRE
  ----------------------------------------------------------------------------
  WITH scope_users AS (
    SELECT DISTINCT user_id FROM _rebill_candidates
  )
  SELECT
    (SELECT COUNT(*) FROM subscriptions_v2 s WHERE s.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM s.access_end_at)::bigint),0) FROM subscriptions_v2 s WHERE s.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COUNT(*) FROM entitlements e WHERE e.user_id IN (SELECT user_id FROM scope_users)),
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.expires_at)::bigint),0) FROM entitlements e WHERE e.user_id IN (SELECT user_id FROM scope_users))
  INTO v_post_subs_rows, v_post_subs_sum, v_post_ent_rows, v_post_ent_sum;

  IF v_post_subs_rows <> v_pre_subs_rows OR v_post_subs_sum <> v_pre_subs_sum THEN
    RAISE EXCEPTION 'INVARIANT FAIL: subscriptions changed pre=(%, %) post=(%, %)',
      v_pre_subs_rows, v_pre_subs_sum, v_post_subs_rows, v_post_subs_sum;
  END IF;
  IF v_post_ent_rows <> v_pre_ent_rows OR v_post_ent_sum <> v_pre_ent_sum THEN
    RAISE EXCEPTION 'INVARIANT FAIL: entitlements changed pre=(%, %) post=(%, %)',
      v_pre_ent_rows, v_pre_ent_sum, v_post_ent_rows, v_post_ent_sum;
  END IF;

  ----------------------------------------------------------------------------
  -- 6. Проверка orphan: payments без order_id
  ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_orphans FROM payments_v2 WHERE order_id IS NULL;
  IF v_orphans > 0 THEN
    -- допустимо если уже было до миграции; проверим лишь по нашим payment_id
    SELECT COUNT(*) INTO v_orphans
    FROM payments_v2 pv JOIN _rebill_candidates c ON c.payment_id=pv.id
    WHERE pv.order_id IS NULL;
    IF v_orphans > 0 THEN
      RAISE EXCEPTION 'INVARIANT FAIL: % payments left orphaned', v_orphans;
    END IF;
  END IF;

  ----------------------------------------------------------------------------
  -- 7. Aggregate stats для audit
  ----------------------------------------------------------------------------
  SELECT
    COUNT(DISTINCT parent_order_id),
    COUNT(DISTINCT user_id),
    SUM(amount)
  INTO v_distinct_parents, v_distinct_users, v_sum_amount
  FROM _rebill_candidates;

  ----------------------------------------------------------------------------
  -- 8. AUDIT LOG
  ----------------------------------------------------------------------------
  INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)
  VALUES (
    'orders.rebill_materialized',
    'system', NULL, v_run,
    jsonb_build_object(
      'run', v_run,
      'inserted', v_inserted,
      'repointed_payments', v_repointed,
      'distinct_parents', v_distinct_parents,
      'distinct_users', v_distinct_users,
      'sum_amount', v_sum_amount,
      'pre_subs_rows', v_pre_subs_rows,
      'pre_subs_sum', v_pre_subs_sum,
      'pre_ent_rows', v_pre_ent_rows,
      'pre_ent_sum', v_pre_ent_sum,
      'post_subs_rows', v_post_subs_rows,
      'post_subs_sum', v_post_subs_sum,
      'post_ent_rows', v_post_ent_rows,
      'post_ent_sum', v_post_ent_sum,
      'products', ARRAY['11c9f1b8-0355-4753-bd74-40b42aa53616','85046734-2282-4ded-b0d3-8c66c8f5bc2b'],
      'period', '[2026-01-01, 2027-01-01)'
    )
  );

  RAISE NOTICE 'OK: % child orders materialized for % parents / % users / sum %',
    v_inserted, v_distinct_parents, v_distinct_users, v_sum_amount;
END
$migration$;
