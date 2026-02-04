-- Fix admin_reconcile_bepaid_legacy_subscriptions
-- Remove LIMIT from CTEs and ARRAY_AGG (syntax errors)
-- Remove product_id/tariff_id (columns don't exist)

DROP FUNCTION IF EXISTS public.admin_reconcile_bepaid_legacy_subscriptions(BOOLEAN, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions(
  p_dry_run BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 500,
  p_reconcile_run_id UUID DEFAULT gen_random_uuid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_distinct_count INTEGER;
  v_already_present INTEGER;
  v_inserted INTEGER := 0;
  v_linked INTEGER := 0;
  v_still_unlinked INTEGER := 0;
  v_sample_ids TEXT[];
  v_result JSONB;
BEGIN
  -- 1) Create temp table with all distinct sbs_* IDs from orders metadata
  CREATE TEMP TABLE IF NOT EXISTS tmp_legacy_sbs ON COMMIT DROP AS
  SELECT DISTINCT ON (sbs_id)
    sbs_id,
    user_id,
    profile_id
  FROM (
    -- From orders_v2.meta
    SELECT 
      COALESCE(meta->>'bepaid_subscription_id', meta->>'sbs_id') AS sbs_id,
      user_id,
      profile_id
    FROM orders_v2
    WHERE status = 'paid'
      AND (meta->>'bepaid_subscription_id' IS NOT NULL OR meta->>'sbs_id' IS NOT NULL)
    
    UNION ALL
    
    -- From legacy orders.meta
    SELECT 
      COALESCE(meta->>'bepaid_subscription_id', meta->>'sbs_id') AS sbs_id,
      user_id,
      NULL::uuid AS profile_id
    FROM orders
    WHERE status = 'paid'
      AND (meta->>'bepaid_subscription_id' IS NOT NULL OR meta->>'sbs_id' IS NOT NULL)
  ) sub
  WHERE sbs_id IS NOT NULL AND sbs_id ~ '^sbs_';

  -- Get total count
  SELECT COUNT(*) INTO v_distinct_count FROM tmp_legacy_sbs;

  -- Get sample IDs (first 20)
  SELECT ARRAY(SELECT sbs_id FROM tmp_legacy_sbs ORDER BY sbs_id LIMIT 20)
  INTO v_sample_ids;

  -- 2) Count how many already exist in provider_subscriptions
  SELECT COUNT(*)
  INTO v_already_present
  FROM provider_subscriptions ps
  JOIN tmp_legacy_sbs t ON t.sbs_id = ps.provider_subscription_id
  WHERE ps.provider = 'bepaid';

  -- 3) Count linked
  SELECT COUNT(*)
  INTO v_linked
  FROM provider_subscriptions ps
  JOIN tmp_legacy_sbs t ON t.sbs_id = ps.provider_subscription_id
  WHERE ps.provider = 'bepaid'
    AND ps.subscription_v2_id IS NOT NULL;

  -- 4) In dry-run, just report counts
  IF p_dry_run THEN
    v_inserted := v_distinct_count - v_already_present;
    
    v_result := jsonb_build_object(
      'success', true,
      'dry_run', true,
      'reconcile_run_id', p_reconcile_run_id,
      'distinct_sbs_ids_total', v_distinct_count,
      'already_present', v_already_present,
      'would_insert', GREATEST(0, v_inserted),
      'linked_to_subscription_v2', v_linked,
      'still_unlinked', v_distinct_count - v_linked,
      'missing_provider_subscriptions_count', GREATEST(0, v_inserted),
      'still_missing_after_execute', GREATEST(0, v_inserted),
      'sample_ids', to_jsonb(v_sample_ids),
      'inserted', 0
    );
    
    DROP TABLE IF EXISTS tmp_legacy_sbs;
    RETURN v_result;
  END IF;

  -- 5) Execute mode: insert missing records (with limit)
  WITH to_insert AS (
    SELECT t.sbs_id, t.user_id, t.profile_id
    FROM tmp_legacy_sbs t
    WHERE NOT EXISTS (
      SELECT 1 FROM provider_subscriptions ps 
      WHERE ps.provider = 'bepaid' AND ps.provider_subscription_id = t.sbs_id
    )
    ORDER BY t.sbs_id
    LIMIT p_limit
  ),
  inserted AS (
    INSERT INTO provider_subscriptions (
      provider,
      provider_subscription_id,
      user_id,
      profile_id,
      state,
      meta,
      created_at,
      updated_at
    )
    SELECT 
      'bepaid',
      ti.sbs_id,
      ti.user_id,
      ti.profile_id,
      'legacy',
      jsonb_build_object(
        'legacy', true,
        'reconcile_run_id', p_reconcile_run_id,
        'reconciled_at', now()
      ),
      now(),
      now()
    FROM to_insert ti
    ON CONFLICT (provider, provider_subscription_id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  -- Recalculate stats after insert
  SELECT COUNT(*)
  INTO v_still_unlinked
  FROM provider_subscriptions ps
  JOIN tmp_legacy_sbs t ON t.sbs_id = ps.provider_subscription_id
  WHERE ps.provider = 'bepaid'
    AND ps.subscription_v2_id IS NULL;

  SELECT COUNT(*)
  INTO v_linked
  FROM provider_subscriptions ps
  JOIN tmp_legacy_sbs t ON t.sbs_id = ps.provider_subscription_id
  WHERE ps.provider = 'bepaid'
    AND ps.subscription_v2_id IS NOT NULL;

  v_result := jsonb_build_object(
    'success', true,
    'dry_run', false,
    'reconcile_run_id', p_reconcile_run_id,
    'distinct_sbs_ids_total', v_distinct_count,
    'already_present', v_already_present,
    'inserted', v_inserted,
    'linked_to_subscription_v2', v_linked,
    'still_unlinked', v_still_unlinked,
    'sample_ids', to_jsonb(v_sample_ids)
  );

  DROP TABLE IF EXISTS tmp_legacy_sbs;
  RETURN v_result;
END;
$$;

-- Security: only service_role can execute
REVOKE ALL ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_bepaid_legacy_subscriptions TO service_role;