CREATE OR REPLACE FUNCTION public.tariff_delete_safety_check(p_tariff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders int;
  v_subs_active int;
  v_subs_total int;
  v_links_active int;
  v_recon int;
  v_lear int;
  v_lecta int;
  v_btmp int;
  v_offers int;
  v_features int;
  v_prices int;
  v_plans int;
  v_rules int;
  v_macc int;
  v_lpr int;
  v_dgr int;
  v_can_hard bool;
BEGIN
  IF NOT (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_orders FROM public.orders_v2 WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_subs_total FROM public.subscriptions_v2 WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_subs_active FROM public.subscriptions_v2 WHERE tariff_id = p_tariff_id AND status::text IN ('active','trial','past_due');
  SELECT count(*) INTO v_links_active FROM public.payment_links WHERE tariff_id = p_tariff_id AND COALESCE(status,'active') NOT IN ('canceled','expired','revoked');
  SELECT count(*) INTO v_recon FROM public.payment_reconcile_queue WHERE matched_tariff_id = p_tariff_id;
  SELECT count(*) INTO v_lear FROM public.live_event_access_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_lecta FROM public.live_event_product_cta_bindings WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_btmp FROM public.broadcast_templates WHERE targeting_tariff_id = p_tariff_id;

  SELECT count(*) INTO v_offers FROM public.tariff_offers WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_features FROM public.tariff_features WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_prices FROM public.tariff_prices WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_plans FROM public.payment_plans WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_rules FROM public.access_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_macc FROM public.module_access WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_lpr FROM public.lesson_price_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_dgr FROM public.document_generation_rules WHERE tariff_id = p_tariff_id;

  v_can_hard := (v_orders + v_subs_total + v_links_active + v_recon + v_lear + v_lecta + v_btmp) = 0;

  RETURN jsonb_build_object(
    'entity','tariff',
    'id', p_tariff_id,
    'blockers', jsonb_build_object(
      'orders_v2', v_orders,
      'subscriptions_v2_active', v_subs_active,
      'subscriptions_v2_total', v_subs_total,
      'payment_links_active', v_links_active,
      'payment_reconcile_queue', v_recon
    ),
    'soft_links', jsonb_build_object(
      'live_event_access_rules', v_lear,
      'live_event_product_cta_bindings', v_lecta,
      'broadcast_templates', v_btmp
    ),
    'cascade_will_remove', jsonb_build_object(
      'tariff_offers', v_offers,
      'tariff_features', v_features,
      'tariff_prices', v_prices,
      'payment_plans', v_plans,
      'access_rules', v_rules,
      'module_access', v_macc,
      'lesson_price_rules', v_lpr,
      'document_generation_rules', v_dgr
    ),
    'can_hard_delete', v_can_hard,
    'recommended_action', CASE WHEN v_can_hard THEN 'hard_delete' ELSE 'soft_archive' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tariff_archive(p_tariff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tariffs SET is_active = false, updated_at = now() WHERE id = p_tariff_id;
  UPDATE public.tariff_offers SET is_active = false, updated_at = now() WHERE tariff_id = p_tariff_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (v_actor, 'tariff_archive', 'user', 'admin', jsonb_build_object('tariff_id', p_tariff_id, 'source', 'tariff_archive_rpc'));

  RETURN jsonb_build_object('ok', true, 'archived', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.offer_archive(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tariff_offers SET is_active = false, updated_at = now() WHERE id = p_offer_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (v_actor, 'offer_archive', 'user', 'admin', jsonb_build_object('offer_id', p_offer_id, 'source', 'offer_archive_rpc'));

  RETURN jsonb_build_object('ok', true, 'archived', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.tariff_hard_delete(p_tariff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_safety jsonb;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_safety := public.tariff_delete_safety_check(p_tariff_id);
  IF NOT (v_safety->>'can_hard_delete')::bool THEN
    RAISE EXCEPTION 'tariff_delete_blocked: %', v_safety::text USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.tariffs WHERE id = p_tariff_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (v_actor, 'tariff_hard_delete', 'user', 'admin', jsonb_build_object('tariff_id', p_tariff_id, 'safety', v_safety));

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.offer_hard_delete(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_safety jsonb;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_safety := public.offer_delete_safety_check(p_offer_id);
  IF NOT (v_safety->>'can_hard_delete')::bool THEN
    RAISE EXCEPTION 'offer_delete_blocked: %', v_safety::text USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.tariff_offers WHERE id = p_offer_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (v_actor, 'offer_hard_delete', 'user', 'admin', jsonb_build_object('offer_id', p_offer_id, 'safety', v_safety));

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;