
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

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, meta)
  VALUES (v_actor, 'tariff_archive', 'admin', jsonb_build_object('tariff_id', p_tariff_id, 'source', 'tariff_archive_rpc'));

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

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, meta)
  VALUES (v_actor, 'offer_archive', 'admin', jsonb_build_object('offer_id', p_offer_id, 'source', 'offer_archive_rpc'));

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

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, meta)
  VALUES (v_actor, 'tariff_hard_delete', 'admin', jsonb_build_object('tariff_id', p_tariff_id, 'safety', v_safety));

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

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, meta)
  VALUES (v_actor, 'offer_hard_delete', 'admin', jsonb_build_object('offer_id', p_offer_id, 'safety', v_safety));

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;
