-- PATCH-D: Fix RPC would_insert calculation and still_missing_after_execute
-- PATCH-F: Revoke GRANT EXECUTE from PUBLIC and authenticated

-- First, revoke all public/authenticated access to sensitive RPC
REVOKE ALL ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions FROM authenticated;

-- Only service_role can call directly (edge functions use service_role)
GRANT EXECUTE ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions TO service_role;

-- PATCH-D: Recreate the RPC with corrected would_insert and still_missing_after_execute logic
CREATE OR REPLACE FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions(
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_reconcile_run_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_distinct_sbs_total integer := 0;
  v_missing_count integer := 0;
  v_already_present integer := 0;
  v_inserted integer := 0;
  v_linked_to_sub_v2 integer := 0;
  v_still_unlinked integer := 0;
  v_sample_ids text[] := ARRAY[]::text[];
  v_would_insert integer := 0;
  v_still_missing_after integer := 0;
  v_batch_count integer := 0;
  rec record;
BEGIN
  -- Create temp table for all legacy sbs IDs found in orders meta
  CREATE TEMP TABLE tmp_legacy_sbs ON COMMIT DROP AS
  SELECT DISTINCT sbs_id FROM (
    SELECT meta->>'bepaid_subscription_id' AS sbs_id
    FROM orders WHERE meta->>'bepaid_subscription_id' IS NOT NULL
    UNION
    SELECT meta->>'bepaid_subscription_id' AS sbs_id
    FROM orders_v2 WHERE meta->>'bepaid_subscription_id' IS NOT NULL
  ) subq
  WHERE sbs_id IS NOT NULL AND sbs_id != '';

  -- Count distinct total
  SELECT count(*) INTO v_distinct_sbs_total FROM tmp_legacy_sbs;

  -- Count already present in provider_subscriptions
  SELECT count(*) INTO v_already_present
  FROM tmp_legacy_sbs l
  JOIN provider_subscriptions ps
    ON ps.provider = 'bepaid' AND ps.provider_subscription_id = l.sbs_id;

  -- Count missing
  SELECT count(*) INTO v_missing_count
  FROM tmp_legacy_sbs l
  LEFT JOIN provider_subscriptions ps
    ON ps.provider = 'bepaid' AND ps.provider_subscription_id = l.sbs_id
  WHERE ps.id IS NULL;

  -- PATCH-D: would_insert = LEAST(missing_count, limit) - this is the batch size
  v_would_insert := LEAST(v_missing_count, p_limit);

  -- Collect sample IDs
  SELECT array_agg(sbs_id) INTO v_sample_ids
  FROM (
    SELECT l.sbs_id
    FROM tmp_legacy_sbs l
    LEFT JOIN provider_subscriptions ps
      ON ps.provider = 'bepaid' AND ps.provider_subscription_id = l.sbs_id
    WHERE ps.id IS NULL
    LIMIT 20
  ) s;

  IF v_sample_ids IS NULL THEN
    v_sample_ids := ARRAY[]::text[];
  END IF;

  -- If dry_run, return stats without inserting
  IF p_dry_run THEN
    -- Audit log for dry-run
    INSERT INTO audit_logs (actor_type, actor_label, action, meta)
    VALUES ('system', 'admin_reconcile_bepaid_legacy', 'bepaid.reconcile.dry_run', jsonb_build_object(
      'reconcile_run_id', p_reconcile_run_id,
      'distinct_sbs_ids_total', v_distinct_sbs_total,
      'missing_provider_subscriptions_count', v_missing_count,
      'already_present', v_already_present,
      'would_insert', v_would_insert,
      'limit', p_limit
    ));

    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'reconcile_run_id', p_reconcile_run_id,
      'distinct_sbs_ids_total', v_distinct_sbs_total,
      'missing_provider_subscriptions_count', v_missing_count,
      'already_present', v_already_present,
      'inserted', 0,
      'would_insert', v_would_insert,
      'linked_to_subscription_v2', 0,
      'still_unlinked', v_missing_count,
      'still_missing_after_execute', v_missing_count,
      'sample_ids', v_sample_ids
    );
  END IF;

  -- Execute mode: Create temp table with best order data for each missing sbs_id
  CREATE TEMP TABLE tmp_best_orders ON COMMIT DROP AS
  WITH all_orders AS (
    -- From orders_v2 with ranking
    SELECT 
      meta->>'bepaid_subscription_id' AS sbs_id,
      id AS order_id,
      'orders_v2' AS order_src,
      user_id,
      profile_id,
      product_id,
      tariff_id,
      final_price,
      currency,
      created_at,
      CASE 
        WHEN paid_amount > 0 THEN 1
        WHEN status = 'paid' THEN 2
        ELSE 4
      END AS rank_score
    FROM orders_v2
    WHERE meta->>'bepaid_subscription_id' IS NOT NULL
    
    UNION ALL
    
    -- From orders with ranking
    SELECT 
      meta->>'bepaid_subscription_id' AS sbs_id,
      id AS order_id,
      'orders' AS order_src,
      user_id,
      profile_id,
      product_id,
      tariff_id,
      final_price,
      currency,
      created_at,
      CASE 
        WHEN status = 'completed' THEN 3
        ELSE 4
      END AS rank_score
    FROM orders
    WHERE meta->>'bepaid_subscription_id' IS NOT NULL
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY sbs_id ORDER BY rank_score, created_at DESC) AS rn
    FROM all_orders
  )
  SELECT r.*
  FROM ranked r
  LEFT JOIN provider_subscriptions ps
    ON ps.provider = 'bepaid' AND ps.provider_subscription_id = r.sbs_id
  WHERE r.rn = 1 AND ps.id IS NULL
  LIMIT p_limit;

  -- Count batch
  SELECT count(*) INTO v_batch_count FROM tmp_best_orders;

  -- Insert into provider_subscriptions
  FOR rec IN SELECT * FROM tmp_best_orders LOOP
    INSERT INTO provider_subscriptions (
      provider,
      provider_subscription_id,
      user_id,
      profile_id,
      product_id,
      tariff_id,
      state,
      amount_cents,
      currency,
      meta,
      created_at,
      updated_at
    ) VALUES (
      'bepaid',
      rec.sbs_id,
      rec.user_id,
      rec.profile_id,
      rec.product_id,
      rec.tariff_id,
      'legacy',  -- state column is TEXT, 'legacy' is valid
      CASE WHEN rec.final_price IS NOT NULL THEN (rec.final_price * 100)::integer ELSE NULL END,
      rec.currency,
      jsonb_build_object(
        'legacy_order_id', rec.order_id,
        'legacy_order_src', rec.order_src,
        'legacy_order_created_at', rec.created_at,
        'legacy_user_id', rec.user_id,
        'legacy_product_id', rec.product_id,
        'legacy_tariff_id', rec.tariff_id,
        'reconcile_run_id', p_reconcile_run_id,
        'reconciled_at', now(),
        'confidence', CASE WHEN rec.rank_score <= 2 THEN 'high' WHEN rec.rank_score = 3 THEN 'medium' ELSE 'low' END,
        'legacy', true,
        'note', 'created from legacy orders meta'
      ),
      now(),
      now()
    )
    ON CONFLICT (provider, provider_subscription_id) DO NOTHING;
    
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Try to link to subscriptions_v2 where possible
  UPDATE provider_subscriptions ps
  SET subscription_v2_id = sv.id
  FROM subscriptions_v2 sv
  WHERE ps.provider = 'bepaid'
    AND ps.subscription_v2_id IS NULL
    AND ps.user_id = sv.user_id
    AND sv.billing_type = 'provider_managed'
    AND sv.status IN ('active', 'trial', 'past_due')
    AND ps.meta->>'reconcile_run_id' = p_reconcile_run_id::text;

  -- Count linked
  SELECT count(*) INTO v_linked_to_sub_v2
  FROM provider_subscriptions
  WHERE meta->>'reconcile_run_id' = p_reconcile_run_id::text
    AND subscription_v2_id IS NOT NULL;

  v_still_unlinked := v_inserted - v_linked_to_sub_v2;

  -- PATCH-D: Recount missing AFTER execute to get real still_missing_after_execute
  SELECT count(*) INTO v_still_missing_after
  FROM tmp_legacy_sbs l
  LEFT JOIN provider_subscriptions ps
    ON ps.provider = 'bepaid' AND ps.provider_subscription_id = l.sbs_id
  WHERE ps.id IS NULL;

  -- Audit log for execute
  INSERT INTO audit_logs (actor_type, actor_label, action, meta)
  VALUES ('system', 'admin_reconcile_bepaid_legacy', 'bepaid.reconcile.execute', jsonb_build_object(
    'reconcile_run_id', p_reconcile_run_id,
    'distinct_sbs_ids_total', v_distinct_sbs_total,
    'missing_before', v_missing_count,
    'inserted', v_inserted,
    'linked_to_subscription_v2', v_linked_to_sub_v2,
    'still_unlinked', v_still_unlinked,
    'still_missing_after_execute', v_still_missing_after,
    'sample_ids', v_sample_ids
  ));

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'reconcile_run_id', p_reconcile_run_id,
    'distinct_sbs_ids_total', v_distinct_sbs_total,
    'missing_provider_subscriptions_count', v_missing_count,
    'already_present', v_already_present,
    'inserted', v_inserted,
    'would_insert', 0,
    'linked_to_subscription_v2', v_linked_to_sub_v2,
    'still_unlinked', v_still_unlinked,
    'still_missing_after_execute', v_still_missing_after,
    'sample_ids', v_sample_ids
  );
END;
$$;

-- Re-grant to service_role only
GRANT EXECUTE ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions TO service_role;

-- Add comment
COMMENT ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions IS 
  'Reconciles legacy bePaid subscription IDs from orders.meta into provider_subscriptions table. 
   PATCH-D: Fixed would_insert calculation and real still_missing_after_execute recount.
   PATCH-F: Revoked public access, only callable via service_role (edge functions).';