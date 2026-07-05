
-- Update offer_delete_safety_check to exclude lead orders from blockers
CREATE OR REPLACE FUNCTION public.offer_delete_safety_check(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders_paid int;
  v_orders_lead int;
  v_lead_with_payments int;
  v_lead_with_entitlements int;
  v_lead_with_subs int;
  v_lead_with_ledger int;
  v_crm_tasks_lead int;
  v_links_active int;
  v_recon int;
  v_lecta int;
  v_dgr int;
  v_bpm int;
  v_can_hard bool;
BEGIN
  IF NOT (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Non-lead orders block hard delete
  SELECT count(*) INTO v_orders_paid
  FROM public.orders_v2
  WHERE offer_id = p_offer_id
    AND status::text <> 'lead';

  -- Lead orders are cascade-deletable — but only if no payments/access/subs
  SELECT count(*) INTO v_orders_lead
  FROM public.orders_v2
  WHERE offer_id = p_offer_id
    AND status::text = 'lead';

  SELECT count(*) INTO v_lead_with_payments
  FROM public.payments_v2 p
  WHERE p.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE offer_id = p_offer_id AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_entitlements
  FROM public.entitlements e
  WHERE e.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE offer_id = p_offer_id AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_subs
  FROM public.subscriptions_v2 s
  WHERE s.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE offer_id = p_offer_id AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_ledger
  FROM public.access_grant_ledger l
  WHERE l.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE offer_id = p_offer_id AND status::text = 'lead'
  );

  SELECT count(*) INTO v_crm_tasks_lead
  FROM public.crm_tasks
  WHERE order_id IN (
    SELECT id FROM public.orders_v2
    WHERE offer_id = p_offer_id AND status::text = 'lead'
  );

  SELECT count(*) INTO v_links_active
  FROM public.payment_links
  WHERE offer_id = p_offer_id
    AND COALESCE(status,'active') NOT IN ('canceled','expired','revoked');

  SELECT count(*) INTO v_recon FROM public.payment_reconcile_queue WHERE matched_offer_id = p_offer_id;
  SELECT count(*) INTO v_lecta FROM public.live_event_product_cta_bindings WHERE offer_id = p_offer_id;
  SELECT count(*) INTO v_dgr FROM public.document_generation_rules WHERE offer_id = p_offer_id;
  SELECT count(*) INTO v_bpm FROM public.bepaid_product_mappings WHERE offer_id = p_offer_id;

  v_can_hard :=
    v_orders_paid = 0
    AND v_links_active = 0
    AND v_recon = 0
    AND v_lead_with_payments = 0
    AND v_lead_with_entitlements = 0
    AND v_lead_with_subs = 0
    AND v_lead_with_ledger = 0;

  RETURN jsonb_build_object(
    'entity','offer',
    'id', p_offer_id,
    'blockers', jsonb_build_object(
      'orders_v2_paid', v_orders_paid,
      'lead_orders_with_payments', v_lead_with_payments,
      'lead_orders_with_entitlements', v_lead_with_entitlements,
      'lead_orders_with_subscriptions', v_lead_with_subs,
      'lead_orders_with_access_ledger', v_lead_with_ledger,
      'payment_links_active', v_links_active,
      'payment_reconcile_queue', v_recon
    ),
    'soft_links', jsonb_build_object(
      'live_event_product_cta_bindings', v_lecta
    ),
    'cascade_will_remove', jsonb_build_object(
      'orders_v2_leads', v_orders_lead,
      'crm_tasks_leads', v_crm_tasks_lead,
      'document_generation_rules', v_dgr,
      'bepaid_product_mappings_unlinked', v_bpm
    ),
    'can_hard_delete', v_can_hard,
    'recommended_action', CASE WHEN v_can_hard THEN 'hard_delete' ELSE 'soft_archive' END
  );
END;
$$;

-- Update offer_hard_delete with lead cascade
CREATE OR REPLACE FUNCTION public.offer_hard_delete(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_safety jsonb;
  v_lead_order_ids uuid[];
  v_deleted_notifications int := 0;
  v_deleted_tasks int := 0;
  v_deleted_orders int := 0;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_safety := public.offer_delete_safety_check(p_offer_id);
  IF NOT (v_safety->>'can_hard_delete')::bool THEN
    RAISE EXCEPTION 'offer_delete_blocked: %', v_safety::text USING ERRCODE = '23503';
  END IF;

  -- Collect lead order ids to cascade-delete
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_lead_order_ids
  FROM public.orders_v2
  WHERE offer_id = p_offer_id AND status::text = 'lead';

  IF array_length(v_lead_order_ids, 1) > 0 THEN
    -- 1) notifications
    WITH d AS (
      DELETE FROM public.crm_task_notifications
      WHERE task_id IN (SELECT id FROM public.crm_tasks WHERE order_id = ANY(v_lead_order_ids))
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_notifications FROM d;

    -- 2) tasks
    WITH d AS (
      DELETE FROM public.crm_tasks
      WHERE order_id = ANY(v_lead_order_ids)
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_tasks FROM d;

    -- 3) lead orders
    WITH d AS (
      DELETE FROM public.orders_v2
      WHERE id = ANY(v_lead_order_ids)
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_orders FROM d;
  END IF;

  -- Existing soft-link cleanup
  UPDATE public.live_event_product_cta_bindings
  SET offer_id = NULL
  WHERE offer_id = p_offer_id;

  -- Finally: delete the offer
  DELETE FROM public.tariff_offers WHERE id = p_offer_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (
    v_actor,
    'offer_hard_delete',
    'user',
    'admin',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'safety', v_safety,
      'cascade', jsonb_build_object(
        'orders_v2_leads_deleted', v_deleted_orders,
        'crm_tasks_leads_deleted', v_deleted_tasks,
        'crm_task_notifications_deleted', v_deleted_notifications
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'cascade', jsonb_build_object(
      'orders_v2_leads_deleted', v_deleted_orders,
      'crm_tasks_leads_deleted', v_deleted_tasks,
      'crm_task_notifications_deleted', v_deleted_notifications
    )
  );
END;
$$;

-- Update tariff_delete_safety_check with same lead-order rule
CREATE OR REPLACE FUNCTION public.tariff_delete_safety_check(p_tariff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders_paid int;
  v_orders_lead int;
  v_lead_with_payments int;
  v_lead_with_entitlements int;
  v_lead_with_subs int;
  v_lead_with_ledger int;
  v_crm_tasks_lead int;
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
  v_offer_ids uuid[];
BEGIN
  IF NOT (public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_offer_ids
  FROM public.tariff_offers WHERE tariff_id = p_tariff_id;

  SELECT count(*) INTO v_orders_paid
  FROM public.orders_v2
  WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
    AND status::text <> 'lead';

  SELECT count(*) INTO v_orders_lead
  FROM public.orders_v2
  WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
    AND status::text = 'lead';

  SELECT count(*) INTO v_lead_with_payments
  FROM public.payments_v2 p
  WHERE p.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
      AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_entitlements
  FROM public.entitlements e
  WHERE e.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
      AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_subs
  FROM public.subscriptions_v2 s
  WHERE s.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
      AND status::text = 'lead'
  );

  SELECT count(*) INTO v_lead_with_ledger
  FROM public.access_grant_ledger l
  WHERE l.order_id IN (
    SELECT id FROM public.orders_v2
    WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
      AND status::text = 'lead'
  );

  SELECT count(*) INTO v_crm_tasks_lead
  FROM public.crm_tasks
  WHERE order_id IN (
    SELECT id FROM public.orders_v2
    WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
      AND status::text = 'lead'
  );

  SELECT count(*) INTO v_subs_total FROM public.subscriptions_v2 WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_subs_active FROM public.subscriptions_v2 WHERE tariff_id = p_tariff_id AND status::text IN ('active','trial','past_due');

  SELECT count(*) INTO v_links_active
  FROM public.payment_links
  WHERE (tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids))
    AND COALESCE(status,'active') NOT IN ('canceled','expired','revoked');

  SELECT count(*) INTO v_recon
  FROM public.payment_reconcile_queue
  WHERE matched_tariff_id = p_tariff_id
     OR matched_offer_id = ANY(v_offer_ids);

  SELECT count(*) INTO v_lear FROM public.live_event_access_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_lecta
  FROM public.live_event_product_cta_bindings
  WHERE tariff_id = p_tariff_id OR offer_id = ANY(v_offer_ids);
  SELECT count(*) INTO v_btmp FROM public.broadcast_templates WHERE targeting_tariff_id = p_tariff_id;

  SELECT count(*) INTO v_offers FROM public.tariff_offers WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_features FROM public.tariff_features WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_prices FROM public.tariff_prices WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_plans FROM public.payment_plans WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_rules FROM public.access_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_macc FROM public.module_access WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_lpr FROM public.lesson_price_rules WHERE tariff_id = p_tariff_id;
  SELECT count(*) INTO v_dgr FROM public.document_generation_rules WHERE tariff_id = p_tariff_id;

  v_can_hard :=
    v_orders_paid = 0
    AND v_subs_total = 0
    AND v_links_active = 0
    AND v_recon = 0
    AND v_lead_with_payments = 0
    AND v_lead_with_entitlements = 0
    AND v_lead_with_subs = 0
    AND v_lead_with_ledger = 0;

  RETURN jsonb_build_object(
    'entity','tariff',
    'id', p_tariff_id,
    'blockers', jsonb_build_object(
      'orders_v2_paid', v_orders_paid,
      'subscriptions_v2_active', v_subs_active,
      'subscriptions_v2_total', v_subs_total,
      'payment_links_active', v_links_active,
      'payment_reconcile_queue', v_recon,
      'lead_orders_with_payments', v_lead_with_payments,
      'lead_orders_with_entitlements', v_lead_with_entitlements,
      'lead_orders_with_subscriptions', v_lead_with_subs,
      'lead_orders_with_access_ledger', v_lead_with_ledger
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
      'document_generation_rules', v_dgr,
      'orders_v2_leads', v_orders_lead,
      'crm_tasks_leads', v_crm_tasks_lead
    ),
    'can_hard_delete', v_can_hard,
    'recommended_action', CASE WHEN v_can_hard THEN 'hard_delete' ELSE 'soft_archive' END
  );
END;
$$;

-- Update tariff_hard_delete with lead cascade
CREATE OR REPLACE FUNCTION public.tariff_hard_delete(p_tariff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_safety jsonb;
  v_lead_order_ids uuid[];
  v_deleted_notifications int := 0;
  v_deleted_tasks int := 0;
  v_deleted_orders int := 0;
BEGIN
  v_actor := auth.uid();
  IF NOT (public.has_role_v2(v_actor, 'super_admin') OR public.has_role_v2(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_safety := public.tariff_delete_safety_check(p_tariff_id);
  IF NOT (v_safety->>'can_hard_delete')::bool THEN
    RAISE EXCEPTION 'tariff_delete_blocked: %', v_safety::text USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_lead_order_ids
  FROM public.orders_v2
  WHERE (tariff_id = p_tariff_id
         OR offer_id IN (SELECT id FROM public.tariff_offers WHERE tariff_id = p_tariff_id))
    AND status::text = 'lead';

  IF array_length(v_lead_order_ids, 1) > 0 THEN
    WITH d AS (
      DELETE FROM public.crm_task_notifications
      WHERE task_id IN (SELECT id FROM public.crm_tasks WHERE order_id = ANY(v_lead_order_ids))
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_notifications FROM d;

    WITH d AS (
      DELETE FROM public.crm_tasks
      WHERE order_id = ANY(v_lead_order_ids)
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_tasks FROM d;

    WITH d AS (
      DELETE FROM public.orders_v2
      WHERE id = ANY(v_lead_order_ids)
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_orders FROM d;
  END IF;

  UPDATE public.live_event_access_rules
  SET tariff_id = NULL
  WHERE tariff_id = p_tariff_id;

  UPDATE public.live_event_product_cta_bindings
  SET tariff_id = CASE WHEN tariff_id = p_tariff_id THEN NULL ELSE tariff_id END,
      offer_id = CASE WHEN offer_id IN (SELECT id FROM public.tariff_offers WHERE tariff_id = p_tariff_id) THEN NULL ELSE offer_id END
  WHERE tariff_id = p_tariff_id
     OR offer_id IN (SELECT id FROM public.tariff_offers WHERE tariff_id = p_tariff_id);

  UPDATE public.broadcast_templates
  SET targeting_tariff_id = NULL
  WHERE targeting_tariff_id = p_tariff_id;

  DELETE FROM public.tariffs WHERE id = p_tariff_id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, actor_label, meta)
  VALUES (
    v_actor,
    'tariff_hard_delete',
    'user',
    'admin',
    jsonb_build_object(
      'tariff_id', p_tariff_id,
      'safety', v_safety,
      'cascade', jsonb_build_object(
        'orders_v2_leads_deleted', v_deleted_orders,
        'crm_tasks_leads_deleted', v_deleted_tasks,
        'crm_task_notifications_deleted', v_deleted_notifications
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'cascade', jsonb_build_object(
      'orders_v2_leads_deleted', v_deleted_orders,
      'crm_tasks_leads_deleted', v_deleted_tasks,
      'crm_task_notifications_deleted', v_deleted_notifications
    )
  );
END;
$$;
