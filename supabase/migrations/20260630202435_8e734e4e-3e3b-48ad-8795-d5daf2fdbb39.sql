CREATE OR REPLACE FUNCTION public.admin_reset_user_trial(
  p_user_id uuid,
  p_product_id uuid,
  p_tariff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_subs_updated int := 0;
  v_orders_updated int := 0;
BEGIN
  -- Only admins (super_admin, admin) may invoke
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_user_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_product_id are required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE user_id = p_user_id LIMIT 1;

  -- Reset subscriptions_v2 trial flag for (user, product[, tariff])
  WITH upd AS (
    UPDATE public.subscriptions_v2 s
    SET is_trial = false,
        updated_at = now()
    WHERE s.user_id = p_user_id
      AND s.product_id = p_product_id
      AND s.is_trial = true
      AND (p_tariff_id IS NULL OR s.tariff_id = p_tariff_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_subs_updated FROM upd;

  -- Reset orders_v2 trial flag too (covers no-card trial path)
  WITH upd AS (
    UPDATE public.orders_v2 o
    SET is_trial = false,
        updated_at = now()
    WHERE o.is_trial = true
      AND o.product_id = p_product_id
      AND (p_tariff_id IS NULL OR o.tariff_id = p_tariff_id)
      AND (
        o.user_id = p_user_id
        OR (v_email IS NOT NULL AND lower(o.customer_email) = lower(v_email))
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_orders_updated FROM upd;

  INSERT INTO public.audit_logs(actor_user_id, actor_type, actor_label, action, target_user_id, meta)
  VALUES (
    v_actor,
    'admin',
    'admin_reset_user_trial',
    'trial.admin_reset',
    p_user_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'tariff_id', p_tariff_id,
      'subscriptions_updated', v_subs_updated,
      'orders_updated', v_orders_updated
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscriptions_updated', v_subs_updated,
    'orders_updated', v_orders_updated
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reset_user_trial(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_trial(uuid, uuid, uuid) TO authenticated, service_role;