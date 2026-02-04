-- PATCH-8: Reconcile legacy bePaid subscriptions (simplified)
-- 1. Add meta column to provider_subscriptions if not exists
ALTER TABLE provider_subscriptions 
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN provider_subscriptions.meta IS 
  'Metadata: legacy_source, reconciled_at, provider_snapshot, cancel_block_reason, etc.';

-- 2. Create idempotent RPC for reconciling legacy subscriptions
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
  v_row record;
  v_existing_ps_id uuid;
  v_existing_sub_v2_id uuid;
  v_matching_sub_v2_id uuid;
BEGIN
  -- Count distinct sbs_ids in legacy orders using temp table approach
  CREATE TEMP TABLE tmp_legacy_sbs ON COMMIT DROP AS
  SELECT DISTINCT sbs_id FROM (
    SELECT meta->>'bepaid_subscription_id' AS sbs_id
    FROM orders WHERE meta->>'bepaid_subscription_id' IS NOT NULL
    UNION
    SELECT meta->>'bepaid_subscription_id' AS sbs_id
    FROM orders_v2 WHERE meta->>'bepaid_subscription_id' IS NOT NULL
  ) x WHERE sbs_id IS NOT NULL;

  SELECT COUNT(*) INTO v_distinct_sbs_total FROM tmp_legacy_sbs;

  -- Count missing in provider_subscriptions
  SELECT COUNT(*) INTO v_missing_count
  FROM tmp_legacy_sbs l
  LEFT JOIN provider_subscriptions ps
    ON ps.provider = 'bepaid' AND ps.provider_subscription_id = l.sbs_id
  WHERE ps.id IS NULL;

  -- Get best order for each sbs_id (prefer orders_v2 with paid_amount > 0)
  CREATE TEMP TABLE tmp_best_orders ON COMMIT DROP AS
  WITH orders_v2_ranked AS (
    SELECT 
      meta->>'bepaid_subscription_id' AS sbs_id,
      'orders_v2' as src,
      id as order_id,
      user_id,
      profile_id,
      product_id,
      tariff_id,
      final_price,
      currency,
      created_at,
      CASE 
        WHEN paid_amount > 0 THEN 1
        WHEN status::text = 'paid' THEN 2
        WHEN status::text = 'completed' THEN 3
        ELSE 4
      END as rank_score,
      ROW_NUMBER() OVER (
        PARTITION BY meta->>'bepaid_subscription_id' 
        ORDER BY 
          CASE 
            WHEN paid_amount > 0 THEN 1
            WHEN status::text = 'paid' THEN 2
            WHEN status::text = 'completed' THEN 3
            ELSE 4
          END,
          created_at DESC
      ) as rn
    FROM orders_v2
    WHERE meta->>'bepaid_subscription_id' IS NOT NULL
  ),
  orders_ranked AS (
    SELECT 
      meta->>'bepaid_subscription_id' AS sbs_id,
      'orders' as src,
      id as order_id,
      user_id,
      NULL::uuid as profile_id,
      NULL::uuid as product_id,
      NULL::uuid as tariff_id,
      NULL::numeric as final_price,
      NULL::text as currency,
      created_at,
      CASE WHEN status = 'completed' THEN 5 ELSE 6 END as rank_score,
      ROW_NUMBER() OVER (
        PARTITION BY meta->>'bepaid_subscription_id' 
        ORDER BY CASE WHEN status = 'completed' THEN 5 ELSE 6 END, created_at DESC
      ) as rn
    FROM orders
    WHERE meta->>'bepaid_subscription_id' IS NOT NULL
  ),
  combined AS (
    SELECT * FROM orders_v2_ranked WHERE rn = 1
    UNION ALL
    SELECT * FROM orders_ranked WHERE rn = 1
  ),
  final_ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY sbs_id ORDER BY rank_score, created_at DESC) as final_rn
    FROM combined
  )
  SELECT sbs_id, src, order_id, user_id, profile_id, product_id, tariff_id, 
         final_price, currency, created_at, rank_score
  FROM final_ranked WHERE final_rn = 1;

  -- Process each sbs_id
  FOR v_row IN SELECT * FROM tmp_best_orders LIMIT p_limit
  LOOP
    -- Check if already in provider_subscriptions
    SELECT id, subscription_v2_id INTO v_existing_ps_id, v_existing_sub_v2_id
    FROM provider_subscriptions
    WHERE provider = 'bepaid' AND provider_subscription_id = v_row.sbs_id;
    
    IF v_existing_ps_id IS NOT NULL THEN
      v_already_present := v_already_present + 1;
      IF v_existing_sub_v2_id IS NOT NULL THEN
        v_linked_to_sub_v2 := v_linked_to_sub_v2 + 1;
      ELSE
        v_still_unlinked := v_still_unlinked + 1;
      END IF;
      CONTINUE;
    END IF;
    
    -- Find matching subscription_v2
    v_matching_sub_v2_id := NULL;
    IF v_row.user_id IS NOT NULL THEN
      SELECT id INTO v_matching_sub_v2_id
      FROM subscriptions_v2
      WHERE user_id = v_row.user_id
        AND billing_type = 'provider_managed'
        AND (product_id = v_row.product_id OR v_row.product_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
    
    -- Sample IDs
    IF array_length(v_sample_ids, 1) IS NULL OR array_length(v_sample_ids, 1) < 20 THEN
      v_sample_ids := v_sample_ids || v_row.sbs_id;
    END IF;
    
    -- Execute mode: insert
    IF NOT p_dry_run THEN
      INSERT INTO provider_subscriptions (
        provider, provider_subscription_id, user_id, profile_id,
        subscription_v2_id, state, amount_cents, currency, meta
      ) VALUES (
        'bepaid',
        v_row.sbs_id,
        v_row.user_id,
        v_row.profile_id,
        v_matching_sub_v2_id,
        'legacy',
        CASE WHEN v_row.final_price IS NOT NULL 
             THEN (v_row.final_price * 100)::integer ELSE NULL END,
        COALESCE(v_row.currency, 'BYN'),
        jsonb_build_object(
          'legacy_source', v_row.src,
          'legacy_order_id', v_row.order_id::text,
          'legacy_order_created_at', v_row.created_at::text,
          'legacy_user_id', v_row.user_id::text,
          'legacy_product_id', v_row.product_id::text,
          'legacy_tariff_id', v_row.tariff_id::text,
          'reconcile_run_id', p_reconcile_run_id::text,
          'reconciled_at', now()::text,
          'confidence', CASE 
            WHEN v_row.rank_score <= 2 THEN 'high'
            WHEN v_row.rank_score <= 4 THEN 'medium'
            ELSE 'low'
          END,
          'note', 'created from legacy orders meta'
        )
      )
      ON CONFLICT (provider, provider_subscription_id) DO NOTHING;
      
      v_inserted := v_inserted + 1;
    END IF;
    
    IF v_matching_sub_v2_id IS NOT NULL THEN
      v_linked_to_sub_v2 := v_linked_to_sub_v2 + 1;
    ELSE
      v_still_unlinked := v_still_unlinked + 1;
    END IF;
  END LOOP;
  
  -- Audit log
  INSERT INTO audit_logs (action, actor_type, actor_label, meta)
  VALUES (
    CASE WHEN p_dry_run THEN 'bepaid.reconcile.dry_run' ELSE 'bepaid.reconcile.execute' END,
    'system',
    'admin_reconcile_bepaid_legacy_subscriptions',
    jsonb_build_object(
      'reconcile_run_id', p_reconcile_run_id,
      'distinct_sbs_ids_total', v_distinct_sbs_total,
      'missing_provider_subscriptions_count', v_missing_count,
      'already_present', v_already_present,
      'inserted', v_inserted,
      'linked_to_subscription_v2', v_linked_to_sub_v2,
      'still_unlinked', v_still_unlinked,
      'limit', p_limit,
      'sample_ids', v_sample_ids
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'reconcile_run_id', p_reconcile_run_id,
    'distinct_sbs_ids_total', v_distinct_sbs_total,
    'missing_provider_subscriptions_count', v_missing_count,
    'already_present', v_already_present,
    'inserted', CASE WHEN p_dry_run THEN 0 ELSE v_inserted END,
    'would_insert', CASE WHEN p_dry_run THEN v_missing_count - v_already_present ELSE 0 END,
    'linked_to_subscription_v2', v_linked_to_sub_v2,
    'still_unlinked', v_still_unlinked,
    'still_missing_after_execute', CASE WHEN p_dry_run THEN v_missing_count ELSE 0 END,
    'sample_ids', v_sample_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions TO authenticated;