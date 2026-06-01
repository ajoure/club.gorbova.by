
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

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_access_to_rule(uuid,uuid) TO authenticated;
