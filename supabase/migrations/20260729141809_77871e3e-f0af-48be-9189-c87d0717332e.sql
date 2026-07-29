CREATE OR REPLACE FUNCTION public.admin_reset_user_trial(
  p_user_id uuid,
  p_product_id uuid,
  p_tariff_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_subs_updated int := 0;
  v_orders_updated int := 0;
  v_blocks_removed int := 0;
  v_remaining_orders int := 0;
  v_remaining_blocks int := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role_v2(v_actor, 'super_admin') THEN
    RAISE EXCEPTION 'forbidden: super_admin role required';
  END IF;

  IF p_user_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_product_id are required';
  END IF;

  SELECT email INTO v_email
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  WITH updated AS (
    UPDATE public.subscriptions_v2 s
    SET is_trial = false, updated_at = now()
    WHERE s.user_id = p_user_id
      AND s.product_id = p_product_id
      AND s.is_trial = true
      AND (p_tariff_id IS NULL OR s.tariff_id = p_tariff_id)
    RETURNING 1
  ) SELECT count(*) INTO v_subs_updated FROM updated;

  WITH updated AS (
    UPDATE public.orders_v2 o
    SET is_trial = false, updated_at = now()
    WHERE o.is_trial = true
      AND o.product_id = p_product_id
      AND (p_tariff_id IS NULL OR o.tariff_id = p_tariff_id)
      AND (o.user_id = p_user_id OR (v_email IS NOT NULL AND lower(o.customer_email) = lower(v_email)))
    RETURNING 1
  ) SELECT count(*) INTO v_orders_updated FROM updated;

  WITH updated AS (
    UPDATE public.trial_blocks b
    SET removed_at = now(), removed_by = v_actor,
        meta = coalesce(b.meta, '{}'::jsonb) || jsonb_build_object('removed_reason', 'admin_trial_reset')
    WHERE b.user_id = p_user_id
      AND b.product_id IS NOT DISTINCT FROM p_product_id
      AND b.removed_at IS NULL
    RETURNING 1
  ) SELECT count(*) INTO v_blocks_removed FROM updated;

  SELECT count(*) INTO v_remaining_orders
  FROM public.orders_v2 o
  WHERE o.is_trial = true
    AND o.product_id = p_product_id
    AND (p_tariff_id IS NULL OR o.tariff_id = p_tariff_id)
    AND (o.user_id = p_user_id OR (v_email IS NOT NULL AND lower(o.customer_email) = lower(v_email)));

  SELECT count(*) INTO v_remaining_blocks
  FROM public.trial_blocks b
  WHERE b.user_id = p_user_id
    AND b.product_id IS NOT DISTINCT FROM p_product_id
    AND b.removed_at IS NULL;

  IF v_remaining_orders <> 0 OR v_remaining_blocks <> 0 THEN
    RAISE EXCEPTION 'trial_reset_incomplete: remaining_orders=%, remaining_blocks=%', v_remaining_orders, v_remaining_blocks;
  END IF;

  INSERT INTO public.audit_logs(actor_user_id, actor_type, actor_label, action, target_user_id, meta)
  VALUES (
    v_actor, 'user', 'admin_reset_user_trial', 'trial.admin_reset', p_user_id,
    jsonb_build_object(
      'product_id', p_product_id, 'tariff_id', p_tariff_id,
      'subscriptions_updated', v_subs_updated, 'orders_updated', v_orders_updated,
      'trial_blocks_removed', v_blocks_removed, 'unblocked', true
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'unblocked', true,
    'subscriptions_updated', v_subs_updated, 'orders_updated', v_orders_updated,
    'trial_blocks_removed', v_blocks_removed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_user_trial(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_trial(uuid, uuid, uuid) TO authenticated, service_role;