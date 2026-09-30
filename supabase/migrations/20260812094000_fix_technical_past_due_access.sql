-- Repair technical subscription shells without turning unpaid provider rows
-- into perpetual access. The migration is deliberately fail-closed against
-- production drift: every data cohort is counted before mutation.

CREATE TEMP TABLE _technical_shell_repairs ON COMMIT DROP AS
SELECT
  s.id,
  s.user_id,
  s.product_id,
  max((l.result->>'access_end')::timestamptz) AS canonical_end
FROM public.subscriptions_v2 s
JOIN public.payments_v2 p
  ON p.order_id = s.order_id
 AND p.status = 'succeeded'
JOIN public.access_grant_ledger l
  ON l.order_id = s.order_id
 AND l.action_type IN ('grant', 'extend')
 AND l.result ? 'access_end'
WHERE s.status = 'past_due'
  AND s.access_end_at IS NULL
  AND s.next_charge_at IS NULL
GROUP BY s.id, s.user_id, s.product_id
HAVING max((l.result->>'access_end')::timestamptz) IS NOT NULL
   AND max((l.result->>'access_end')::timestamptz) <= now();

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM _technical_shell_repairs;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'technical_shell_repair_count_mismatch: expected=3 actual=%', v_count;
  END IF;
END;
$$;
UPDATE public.subscriptions_v2 s
SET access_end_at = r.canonical_end,
    status = 'superseded',
    meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object(
      'backfill_2026_08_12', 'shell_pastdue_null_access_end',
      'canonical_end_source', 'access_grant_ledger'
    ),
    updated_at = now()
FROM _technical_shell_repairs r
WHERE s.id = r.id
  AND s.status = 'past_due'
  AND s.access_end_at IS NULL
  AND s.next_charge_at IS NULL;

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.subscriptions_v2 s
  JOIN _technical_shell_repairs r ON r.id = s.id
  WHERE s.status = 'superseded'
    AND s.access_end_at = r.canonical_end;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'technical_shell_repair_readback_mismatch: expected=3 actual=%', v_count;
  END IF;
END;
$$;

-- Align the one live public-link installment replacement with the canonical
-- 300-day product window. Billing cadence remains untouched: installments do
-- not add another 300 days on every charge.
CREATE TEMP TABLE _live_installment_alignment ON COMMIT DROP AS
SELECT
  new_s.id AS live_subscription_id,
  old_s.id AS replaced_subscription_id,
  e.expires_at AS canonical_end,
  new_s.next_charge_at AS preserved_next_charge_at
FROM public.orders_v2 new_o
JOIN public.subscriptions_v2 new_s ON new_s.order_id = new_o.id
JOIN public.orders_v2 old_o
  ON old_o.user_id = new_o.user_id
 AND old_o.product_id = new_o.product_id
  AND old_o.order_number = 'SUB-LINK-MS69W0DD'
JOIN public.subscriptions_v2 old_s ON old_s.order_id = old_o.id
JOIN public.entitlements e
  ON e.user_id = new_o.user_id
 AND e.product_id = new_o.product_id
 AND e.status = 'active'
WHERE new_o.order_number = 'SUB-LINK-MSOFLH7I'
  AND new_s.status = 'past_due'
  AND new_s.access_end_at IS NULL
  AND new_s.next_charge_at > now()
  AND old_s.status = 'active'
  AND old_s.access_end_at IS NOT NULL
  AND e.expires_at IS NOT NULL
  AND e.expires_at > new_s.next_charge_at;

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM _live_installment_alignment;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'live_installment_alignment_count_mismatch: expected=1 actual=%', v_count;
  END IF;
END;
$$;

UPDATE public.subscriptions_v2 s
SET status = 'active',
    access_end_at = a.canonical_end,
    meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object(
      'backfill_2026_08_12', 'public_link_installment_window_alignment',
      'canonical_end_source', 'entitlement'
    ),
    updated_at = now()
FROM _live_installment_alignment a
WHERE s.id = a.live_subscription_id
  AND s.status = 'past_due'
  AND s.access_end_at IS NULL
  AND s.next_charge_at = a.preserved_next_charge_at;

UPDATE public.subscriptions_v2 s
SET status = 'superseded',
    meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object(
      'backfill_2026_08_12', 'public_link_installment_replaced'
    ),
    updated_at = now()
FROM _live_installment_alignment a
WHERE s.id = a.replaced_subscription_id
  AND s.status = 'active'
  AND s.access_end_at IS NOT NULL;

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM _live_installment_alignment a
  JOIN public.subscriptions_v2 live_s ON live_s.id = a.live_subscription_id
  JOIN public.subscriptions_v2 old_s ON old_s.id = a.replaced_subscription_id
  WHERE live_s.status = 'active'
    AND live_s.access_end_at = a.canonical_end
    AND live_s.next_charge_at = a.preserved_next_charge_at
    AND old_s.status = 'superseded';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'live_installment_alignment_readback_mismatch: expected=1 actual=%', v_count;
  END IF;
END;
$$;

-- Capture the one aggregate that became falsely perpetual only because a
-- technical past_due+NULL row participated in the old RPC. Legitimate
-- perpetual manual/active/trial sources are explicitly excluded.
CREATE TEMP TABLE _aggregate_recalc_targets ON COMMIT DROP AS
WITH finite_windows AS (
  SELECT e.user_id, e.product_id, max(x.expires_at) AS expected_expires_at
  FROM public.entitlements e
  CROSS JOIN LATERAL (
    SELECT es.expires_at
    FROM public.entitlement_sources es
    WHERE es.user_id = e.user_id
      AND es.product_id = e.product_id
      AND es.status = 'active'
      AND es.starts_at <= now()
      AND es.expires_at > now()
    UNION ALL
    SELECT s.access_end_at
    FROM public.subscriptions_v2 s
    WHERE s.user_id = e.user_id
      AND s.product_id = e.product_id
      AND (
        s.status IN ('active', 'trial')
        OR (s.status IN ('past_due', 'canceled') AND s.access_end_at IS NOT NULL)
      )
      AND s.access_end_at > now()
  ) x
  WHERE e.status = 'active'
    AND e.expires_at IS NULL
  GROUP BY e.user_id, e.product_id
)
SELECT fw.user_id, fw.product_id, fw.expected_expires_at
FROM finite_windows fw
WHERE NOT EXISTS (
    SELECT 1 FROM public.entitlement_sources es
    WHERE es.user_id = fw.user_id
      AND es.product_id = fw.product_id
      AND es.status = 'active'
      AND es.starts_at <= now()
      AND es.expires_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions_v2 s
    WHERE s.user_id = fw.user_id
      AND s.product_id = fw.product_id
      AND s.status IN ('active', 'trial')
      AND s.access_end_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.subscriptions_v2 s
    WHERE s.user_id = fw.user_id
      AND s.product_id = fw.product_id
      AND s.status = 'past_due'
      AND s.access_end_at IS NULL
  );

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM _aggregate_recalc_targets;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'aggregate_recalc_target_count_mismatch: expected=1 actual=%', v_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_entitlement_aggregate(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ent_id uuid;
  v_product_code text;
  v_profile_id uuid;
  v_effective_tariff_id uuid;
  v_effective_source_ref text;
  v_effective_source_type text;
  v_effective_rank integer;
  v_has_perpetual boolean := false;
  v_max_expires timestamptz;
  v_source_count integer := 0;
  v_subscription_count integer := 0;
  v_total_count integer := 0;
  v_meta jsonb;
BEGIN
  IF p_user_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'recalculate_entitlement_aggregate: user_id and product_id required';
  END IF;

  SELECT p.code INTO v_product_code
  FROM public.products_v2 p
  WHERE p.id = p_product_id;

  IF v_product_code IS NULL THEN
    RAISE EXCEPTION 'recalculate_entitlement_aggregate: product_not_found:%', p_product_id;
  END IF;

  SELECT id INTO v_ent_id
  FROM public.entitlements
  WHERE user_id = p_user_id AND product_id = p_product_id
  FOR UPDATE;

  SELECT es.profile_id INTO v_profile_id
  FROM public.entitlement_sources es
  WHERE es.user_id = p_user_id
    AND es.product_id = p_product_id
    AND es.profile_id IS NOT NULL
  ORDER BY es.created_at DESC
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT p.id INTO v_profile_id
    FROM public.profiles p
    WHERE p.user_id = p_user_id
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  WITH active_sources AS (
    SELECT
      es.id::text AS source_ref,
      es.source_type,
      es.tariff_id,
      es.expires_at,
      es.created_at,
      public.tariff_access_rank(es.tariff_id) AS access_rank
    FROM public.entitlement_sources es
    WHERE es.user_id = p_user_id
      AND es.product_id = p_product_id
      AND es.status = 'active'
      AND es.starts_at <= now()
      AND (es.expires_at IS NULL OR es.expires_at > now())
  ),
  active_subscriptions AS (
    SELECT
      s.id::text AS source_ref,
      'subscription'::text AS source_type,
      s.tariff_id,
      s.access_end_at AS expires_at,
      s.created_at,
      public.tariff_access_rank(s.tariff_id) AS access_rank
    FROM public.subscriptions_v2 s
    WHERE s.user_id = p_user_id
      AND s.product_id = p_product_id
      AND (
        s.status IN ('active', 'trial')
        OR (s.status IN ('past_due', 'canceled') AND s.access_end_at IS NOT NULL)
      )
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  ),
  candidates AS (
    SELECT * FROM active_sources
    UNION ALL
    SELECT * FROM active_subscriptions
  )
  SELECT c.tariff_id, c.source_ref, c.source_type, c.access_rank
  INTO v_effective_tariff_id, v_effective_source_ref, v_effective_source_type, v_effective_rank
  FROM candidates c
  ORDER BY c.access_rank DESC NULLS LAST,
           c.expires_at DESC NULLS FIRST,
           c.created_at DESC,
           c.source_ref DESC
  LIMIT 1;

  SELECT
    COUNT(*),
    COALESCE(bool_or(expires_at IS NULL), false),
    MAX(expires_at)
  INTO v_source_count, v_has_perpetual, v_max_expires
  FROM public.entitlement_sources
  WHERE user_id = p_user_id
    AND product_id = p_product_id
    AND status = 'active'
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now());

  SELECT COUNT(*) INTO v_subscription_count
  FROM public.subscriptions_v2
  WHERE user_id = p_user_id
    AND product_id = p_product_id
    AND (
      status IN ('active', 'trial')
      OR (status IN ('past_due', 'canceled') AND access_end_at IS NOT NULL)
    )
    AND (access_end_at IS NULL OR access_end_at > now());

  SELECT
    COALESCE(bool_or(x.expires_at IS NULL), false),
    MAX(x.expires_at)
  INTO v_has_perpetual, v_max_expires
  FROM (
    SELECT es.expires_at
    FROM public.entitlement_sources es
    WHERE es.user_id = p_user_id
      AND es.product_id = p_product_id
      AND es.status = 'active'
      AND es.starts_at <= now()
      AND (es.expires_at IS NULL OR es.expires_at > now())
    UNION ALL
    SELECT s.access_end_at
    FROM public.subscriptions_v2 s
    WHERE s.user_id = p_user_id
      AND s.product_id = p_product_id
      AND (
        s.status IN ('active', 'trial')
        OR (s.status IN ('past_due', 'canceled') AND s.access_end_at IS NOT NULL)
      )
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  ) x;

  v_total_count := v_source_count + v_subscription_count;

  IF v_total_count = 0 THEN
    IF v_ent_id IS NOT NULL THEN
      UPDATE public.entitlements
      SET status = 'expired',
          meta = (COALESCE(meta, '{}'::jsonb)
                  - 'effective_source_id'
                  - 'effective_source_ref'
                  - 'effective_source_type'
                  - 'effective_access_rank'
                  - 'tariff_id')
                 || jsonb_build_object(
                      'active_sources', 0,
                      'active_subscriptions', 0,
                      'recalculated_at', now(),
                      'closed_reason', 'no_active_sources'
                    ),
          updated_at = now()
      WHERE id = v_ent_id;
    END IF;

    RETURN jsonb_build_object(
      'status', CASE WHEN v_ent_id IS NULL THEN 'no_entitlement_row' ELSE 'expired' END,
      'active_sources', 0,
      'active_subscriptions', 0
    );
  END IF;

  v_meta := jsonb_build_object(
    'effective_source_ref', v_effective_source_ref,
    'effective_source_type', v_effective_source_type,
    'effective_access_rank', v_effective_rank,
    'active_sources', v_source_count,
    'active_subscriptions', v_subscription_count,
    'perpetual', v_has_perpetual,
    'recalculated_at', now()
  );
  IF v_effective_tariff_id IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object('tariff_id', v_effective_tariff_id);
  END IF;

  IF v_ent_id IS NULL THEN
    INSERT INTO public.entitlements (
      user_id, profile_id, product_id, product_code, status, expires_at, meta
    ) VALUES (
      p_user_id,
      v_profile_id,
      p_product_id,
      v_product_code,
      'active',
      CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
      v_meta
    )
    ON CONFLICT (user_id, product_code) DO UPDATE
    SET product_id = EXCLUDED.product_id,
        profile_id = COALESCE(EXCLUDED.profile_id, public.entitlements.profile_id),
        status = 'active',
        expires_at = EXCLUDED.expires_at,
        meta = (COALESCE(public.entitlements.meta, '{}'::jsonb) - 'tariff_id') || EXCLUDED.meta,
        updated_at = now()
    RETURNING id INTO v_ent_id;
  ELSE
    UPDATE public.entitlements
    SET profile_id = COALESCE(profile_id, v_profile_id),
        status = 'active',
        expires_at = CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
        meta = (COALESCE(meta, '{}'::jsonb)
                - 'effective_source_id'
                - 'effective_source_ref'
                - 'effective_source_type'
                - 'effective_access_rank'
                - 'tariff_id') || v_meta,
        updated_at = now()
    WHERE id = v_ent_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'active',
    'entitlement_id', v_ent_id,
    'effective_tariff_id', v_effective_tariff_id,
    'effective_source_ref', v_effective_source_ref,
    'effective_source_type', v_effective_source_type,
    'effective_access_rank', v_effective_rank,
    'effective_expires_at', CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
    'active_sources', v_source_count,
    'active_subscriptions', v_subscription_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id, product_id FROM _technical_shell_repairs
    UNION
    SELECT user_id, product_id FROM _aggregate_recalc_targets
  LOOP
    PERFORM public.recalculate_entitlement_aggregate(r.user_id, r.product_id);
  END LOOP;
END;
$$;

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM _aggregate_recalc_targets r
  JOIN public.entitlements e
    ON e.user_id = r.user_id
   AND e.product_id = r.product_id
  WHERE e.status = 'active'
    AND e.expires_at = r.expected_expires_at;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'aggregate_recalc_readback_mismatch: expected=1 actual=%', v_count;
  END IF;
END;
$$;
