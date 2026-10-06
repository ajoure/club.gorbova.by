-- Preserve existing function owner/ACL. Only add fully paid CB AI fallback.

CREATE OR REPLACE FUNCTION public.user_has_access_to_rule(p_user uuid, p_rule_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_tariff_id  uuid;
  v_candidate record;
  v_cycles integer;
  v_total numeric;
  v_paid_count integer;
  v_paid_total numeric;
BEGIN
  IF p_user IS NULL OR p_rule_id IS NULL THEN RETURN false; END IF;

  SELECT product_id, tariff_id INTO v_product_id, v_tariff_id
  FROM public.access_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Active subscription_v2 на этот product (+ tariff если задан)
  IF EXISTS (
    SELECT 1 FROM public.subscriptions_v2 s
    WHERE s.user_id = p_user
      AND s.status::text IN ('active','trialing','past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
      AND (v_product_id IS NULL OR s.product_id = v_product_id)
      AND (v_tariff_id  IS NULL OR s.tariff_id  = v_tariff_id)
  ) THEN
    RETURN true;
  END IF;

  -- Active entitlement на product (entitlements не несут tariff, поэтому при tariff-scoped правиле допускаем product-level entitlement только если правило не tariff-scoped)
  IF v_tariff_id IS NULL AND v_product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = p_user
      AND e.status = 'active'
      AND e.product_id = v_product_id
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ) THEN
    RETURN true;
  END IF;

  -- Provider billing may finish before the purchased course access finishes.
  -- Keep this fallback limited to the four managed CB AI services; do not
  -- reactivate subscriptions, retry billing, or broaden other access rules.
  IF v_tariff_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.access_rules ar
    JOIN public.app_sections sec ON sec.id::text = ar.target_ref
    WHERE ar.id = p_rule_id AND ar.is_active = true
      AND ar.grant_target_type = 'section_access' AND sec.is_active = true
      AND sec.code IN ('ai_asset_classifier', 'ai_bank_statement_analysis',
                       'ai_act_reconciliation', 'ai_accounting_regulations')
      AND ar.product_id IN ('3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
                           '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid)
  ) THEN
    FOR v_candidate IN
      SELECT s.order_id, o.meta->'installment' AS agreement
      FROM public.subscriptions_v2 s
      JOIN public.orders_v2 o ON o.id = s.order_id
      WHERE s.user_id = p_user AND s.product_id = v_product_id
        AND s.tariff_id = v_tariff_id AND s.status::text IN ('expired', 'canceled')
        AND s.access_start_at <= now() AND s.access_end_at > now()
        AND o.user_id = p_user AND o.product_id = s.product_id
        AND o.tariff_id = s.tariff_id AND o.status::text = 'paid' AND o.currency = 'BYN'
        AND COALESCE(o.meta->'manual_review', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
        AND o.meta->'installment'->>'model' = 'bepaid_finite_subscription'
        AND o.meta->'installment'->>'infinite' = 'false'
        AND o.meta->'installment'->>'original_order_id' = o.id::text
        AND COALESCE(s.meta->'manual_review', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
        AND s.meta->'installment'->>'model' = o.meta->'installment'->>'model'
        AND s.meta->'installment'->>'infinite' = o.meta->'installment'->>'infinite'
        AND s.meta->'installment'->>'original_order_id' = o.meta->'installment'->>'original_order_id'
        AND s.meta->'installment'->>'billing_cycles' = o.meta->'installment'->>'billing_cycles'
        AND s.meta->'installment'->>'effective_total_byn' = o.meta->'installment'->>'effective_total_byn'
        AND s.meta->'installment'->>'per_payment_byn' = o.meta->'installment'->>'per_payment_byn'
        AND EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.user_id = p_user AND e.product_id = s.product_id
            AND e.order_id = o.id AND e.status = 'active' AND e.expires_at > now()
        )
    LOOP
      -- Parse only validated numeric strings. Malformed legacy metadata denies.
      IF COALESCE(v_candidate.agreement->>'billing_cycles', '') !~ '^[0-9]{1,3}$'
        OR COALESCE(v_candidate.agreement->>'per_payment_byn', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
        OR COALESCE(v_candidate.agreement->>'effective_total_byn', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
      THEN CONTINUE; END IF;
      v_cycles := (v_candidate.agreement->>'billing_cycles')::integer;
      v_total := (v_candidate.agreement->>'effective_total_byn')::numeric;
      IF v_cycles < 2 OR v_cycles > 60 OR v_total <= 0
        OR (v_candidate.agreement->>'per_payment_byn')::numeric <= 0 THEN CONTINUE; END IF;

      -- Any refund, conflicting identity/type or duplicate UID, or unidentifiable successful
      -- money fact requires review, even when remaining rows equal the price.
      IF EXISTS (
        SELECT 1 FROM public.payments_v2 p
        WHERE p.order_id = v_candidate.order_id
          AND (p.status::text IN ('refunded', 'partially_refunded')
            OR COALESCE(p.refunded_amount, 0) <> 0
            OR (p.status::text = 'succeeded' AND NOT COALESCE(p.is_deleted, false) AND (
              p.user_id IS DISTINCT FROM p_user OR p.currency IS DISTINCT FROM 'BYN'
              OR p.provider IS DISTINCT FROM 'bepaid'
              OR NULLIF(trim(p.provider_payment_id), '') IS NULL
              OR p.amount <= 0 OR p.amount <> round(p.amount, 2)
              OR lower(trim(COALESCE(p.transaction_type, ''))) NOT IN ('payment','capture','платеж','платёж')
            )))
      ) THEN CONTINUE; END IF;
      IF EXISTS (
        SELECT 1 FROM public.payments_v2 p
        WHERE p.order_id = v_candidate.order_id AND p.status::text = 'succeeded'
          AND NOT COALESCE(p.is_deleted, false)
        GROUP BY p.provider, p.provider_payment_id HAVING count(*) > 1
      ) THEN CONTINUE; END IF;
      SELECT count(*), COALESCE(sum(amount), 0) INTO v_paid_count, v_paid_total
      FROM (
        SELECT p.provider, p.provider_payment_id, min(p.amount) AS amount
        FROM public.payments_v2 p
        WHERE p.order_id = v_candidate.order_id AND p.status::text = 'succeeded'
          AND NOT COALESCE(p.is_deleted, false)
        GROUP BY p.provider, p.provider_payment_id
      ) paid;
      IF v_paid_count = v_cycles AND v_paid_total = v_total THEN RETURN true; END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$$;
