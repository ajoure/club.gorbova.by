-- Independent finite Club bonuses.
--
-- A paid Club subscription and a finite bonus from another product are
-- separate commercial sources.  The aggregate entitlement keeps the widest
-- active window while its effective tariff is selected by the configured
-- numeric rank of the active sources.  Product/tariff names are never used for
-- access decisions.

ALTER TABLE public.entitlement_sources
  DROP CONSTRAINT IF EXISTS entitlement_sources_type_chk;

ALTER TABLE public.entitlement_sources
  ADD CONSTRAINT entitlement_sources_type_chk
  CHECK (source_type IN (
    'order',
    'manual_grant',
    'subscription',
    'upgrade',
    'migration',
    'bonus'
  ));

CREATE OR REPLACE FUNCTION public.tariff_access_rank(p_tariff_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN t.meta->>'access_rank' ~ '^-?[0-9]+$'
      THEN (t.meta->>'access_rank')::integer
    ELSE COALESCE(t.sort_order, t.display_order)
  END
  FROM public.tariffs t
  WHERE t.id = p_tariff_id;
$$;

REVOKE ALL ON FUNCTION public.tariff_access_rank(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tariff_access_rank(uuid) TO authenticated, service_role;

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
      AND s.status IN ('active', 'trial', 'past_due')
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
    AND status IN ('active', 'trial', 'past_due')
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
      AND s.status IN ('active', 'trial', 'past_due')
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

CREATE OR REPLACE FUNCTION public.upsert_club_bonus_entitlement_source(
  p_order_id uuid,
  p_access_rule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders_v2%ROWTYPE;
  v_rule public.access_rules%ROWTYPE;
  v_target_product_id uuid;
  v_target_product_code text;
  v_target_tariff_id uuid;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_source_ref text;
  v_source_id uuid;
  v_existing public.entitlement_sources%ROWTYPE;
  v_recalc jsonb;
  v_source_product_name text;
  v_source_tariff_name text;
BEGIN
  IF p_order_id IS NULL OR p_access_rule_id IS NULL THEN
    RAISE EXCEPTION 'upsert_club_bonus_entitlement_source: order_id and access_rule_id required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders_v2
  WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'paid'::public.order_status THEN
    RAISE EXCEPTION 'club_bonus_order_not_paid:%', p_order_id;
  END IF;
  IF v_order.user_id IS NULL OR v_order.product_id IS NULL THEN
    RAISE EXCEPTION 'club_bonus_order_owner_or_product_missing:%', p_order_id;
  END IF;

  SELECT * INTO v_rule
  FROM public.access_rules
  WHERE id = p_access_rule_id
    AND is_active = true
    AND grant_target_type = 'club';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_bonus_rule_not_active:%', p_access_rule_id;
  END IF;
  IF v_rule.product_id IS DISTINCT FROM v_order.product_id
     OR (v_rule.tariff_id IS NOT NULL AND v_rule.tariff_id IS DISTINCT FROM v_order.tariff_id) THEN
    RAISE EXCEPTION 'club_bonus_rule_scope_mismatch:%', p_access_rule_id;
  END IF;
  IF v_rule.duration_days IS NULL OR v_rule.duration_days <= 0 THEN
    RAISE EXCEPTION 'club_bonus_rule_duration_invalid:%', p_access_rule_id;
  END IF;

  BEGIN
    v_target_tariff_id := NULLIF(v_rule.conditions->>'grant_tariff_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'club_bonus_target_tariff_invalid:%', p_access_rule_id;
  END;
  IF v_target_tariff_id IS NULL THEN
    RAISE EXCEPTION 'club_bonus_target_tariff_missing:%', p_access_rule_id;
  END IF;

  SELECT p.id, p.code INTO v_target_product_id, v_target_product_code
  FROM public.products_v2 p
  WHERE p.telegram_club_id = v_rule.target_ref::uuid
    AND p.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_bonus_target_product_not_found:%', v_rule.target_ref;
  END IF;

  PERFORM 1
  FROM public.tariffs t
  WHERE t.id = v_target_tariff_id
    AND t.product_id = v_target_product_id
    AND t.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'club_bonus_target_tariff_not_active:%', v_target_tariff_id;
  END IF;

  SELECT MIN(p.paid_at) INTO v_starts_at
  FROM public.payments_v2 p
  WHERE p.order_id = p_order_id
    AND p.status = 'succeeded'
    AND COALESCE(p.is_deleted, false) = false
    AND p.paid_at IS NOT NULL;

  v_starts_at := COALESCE(
    v_starts_at,
    NULLIF(v_order.meta->>'paid_at', '')::timestamptz,
    v_order.updated_at,
    v_order.created_at
  );
  v_expires_at := v_starts_at + make_interval(days => v_rule.duration_days);
  v_source_ref := 'club_bonus:' || p_order_id::text || ':' || p_access_rule_id::text;

  SELECT p.name INTO v_source_product_name
  FROM public.products_v2 p
  WHERE p.id = v_order.product_id;
  SELECT t.name INTO v_source_tariff_name
  FROM public.tariffs t
  WHERE t.id = v_order.tariff_id;

  INSERT INTO public.entitlement_sources (
    source_type, source_ref, user_id, profile_id, product_id, tariff_id,
    order_id, starts_at, expires_at, status, meta
  ) VALUES (
    'bonus', v_source_ref, v_order.user_id, v_order.profile_id,
    v_target_product_id, v_target_tariff_id, p_order_id,
    v_starts_at, v_expires_at, 'active',
    jsonb_build_object(
      'origin', 'upsert_club_bonus_entitlement_source',
      'source_rule_id', p_access_rule_id,
      'source_product_id', v_order.product_id,
      'source_product_name', v_source_product_name,
      'source_tariff_id', v_order.tariff_id,
      'source_tariff_name', v_source_tariff_name,
      'target_club_id', v_rule.target_ref,
      'duration_days', v_rule.duration_days
    )
  )
  ON CONFLICT (source_type, source_ref) DO NOTHING
  RETURNING id INTO v_source_id;

  IF v_source_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.entitlement_sources
    WHERE source_type = 'bonus' AND source_ref = v_source_ref;

    IF NOT FOUND
       OR v_existing.user_id IS DISTINCT FROM v_order.user_id
       OR v_existing.product_id IS DISTINCT FROM v_target_product_id
       OR v_existing.tariff_id IS DISTINCT FROM v_target_tariff_id
       OR v_existing.starts_at IS DISTINCT FROM v_starts_at
       OR v_existing.expires_at IS DISTINCT FROM v_expires_at THEN
      RAISE EXCEPTION 'club_bonus_source_conflict:%', v_source_ref;
    END IF;
    v_source_id := v_existing.id;
  END IF;

  v_recalc := public.recalculate_entitlement_aggregate(v_order.user_id, v_target_product_id);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_existing.id IS NULL THEN 'inserted' ELSE 'exists' END,
    'source_id', v_source_id,
    'source_ref', v_source_ref,
    'product_id', v_target_product_id,
    'tariff_id', v_target_tariff_id,
    'starts_at', v_starts_at,
    'expires_at', v_expires_at,
    'recalc', v_recalc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_club_bonus_entitlement_source(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_club_bonus_entitlement_source(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.upsert_club_bonus_entitlement_source(uuid, uuid) IS
  'Idempotently creates a finite Club bonus source from a paid order and a configured club access rule.';

-- Production configuration is explicit and UUID-based.  These ranks mirror
-- the current administrator ordering and remain editable through tariff meta;
-- application code never compares names or codes.
DO $$
DECLARE
  v_tariff_rows integer;
  v_rule_rows integer;
BEGIN
  UPDATE public.tariffs
  SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'access_rank', CASE id
          WHEN '31f75673-a7ae-420a-b5ab-5906e34cbf84'::uuid THEN 10
          WHEN 'b276d8a5-8e5f-4876-9f99-36f818722d6c'::uuid THEN 20
          WHEN '7c748940-dcad-4c7c-a92e-76a2344622d3'::uuid THEN 30
          WHEN 'b018e9be-53ce-4840-8034-e09f8e319080'::uuid THEN 40
        END
      ),
      updated_at = now()
  WHERE product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid
    AND id IN (
      '31f75673-a7ae-420a-b5ab-5906e34cbf84'::uuid,
      'b276d8a5-8e5f-4876-9f99-36f818722d6c'::uuid,
      '7c748940-dcad-4c7c-a92e-76a2344622d3'::uuid,
      'b018e9be-53ce-4840-8034-e09f8e319080'::uuid
    );
  GET DIAGNOSTICS v_tariff_rows = ROW_COUNT;
  IF v_tariff_rows <> 4 THEN
    RAISE EXCEPTION 'club_bonus_config_tariff_count_mismatch:%', v_tariff_rows;
  END IF;

  UPDATE public.access_rules
  SET conditions = COALESCE(conditions, '{}'::jsonb) || jsonb_build_object(
        'grant_tariff_id', CASE id
          WHEN 'f2b4d230-3686-4a30-ba66-d01f10626585'::uuid
            THEN 'b276d8a5-8e5f-4876-9f99-36f818722d6c'::text
          WHEN 'c59868f2-dda6-4c8f-a32d-b54c1174cc04'::uuid
            THEN '7c748940-dcad-4c7c-a92e-76a2344622d3'::text
        END
      ),
      updated_at = now()
  WHERE id IN (
      'f2b4d230-3686-4a30-ba66-d01f10626585'::uuid,
      'c59868f2-dda6-4c8f-a32d-b54c1174cc04'::uuid
    )
    AND is_active = true
    AND grant_target_type = 'club'
    AND duration_days = 30;
  GET DIAGNOSTICS v_rule_rows = ROW_COUNT;
  IF v_rule_rows <> 2 THEN
    RAISE EXCEPTION 'club_bonus_config_rule_count_mismatch:%', v_rule_rows;
  END IF;
END;
$$;
