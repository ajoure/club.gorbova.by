-- Recognize the existing order-based entitlement model without replaying any grant.
CREATE OR REPLACE FUNCTION public.admin_claim_historical_manual_access_v1(p_actor_id uuid,p_order_id uuid,p_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE o public.orders_v2%ROWTYPE; a public.historical_manual_installments%ROWTYPE;
  s public.subscriptions_v2%ROWTYPE; start_at timestamptz; days integer; end_at timestamptz; n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor_id IS NULL
    OR public.has_admin_section_access(p_actor_id,'payments','edit') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'historical_manual_forbidden'; END IF;
  SELECT * INTO o FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO a FROM public.historical_manual_installments WHERE order_id=o.id AND profile_id=p_profile_id;
  IF a.id IS NULL OR a.user_id IS DISTINCT FROM o.user_id OR o.profile_id IS DISTINCT FROM p_profile_id
    OR o.status::text NOT IN ('partial','paid') OR o.paid_amount<a.per_payment_byn THEN
    RAISE EXCEPTION 'historical_manual_identity_mismatch'; END IF;
  -- Order-based modules deliberately have no subscription row. After the
  -- one durable dispatch, verify their canonical paid entitlement instead.
  -- This branch is read-only: missing/invalid rights never dispatch again.
  IF EXISTS(SELECT 1 FROM public.products_v2 WHERE id=o.product_id AND entitlement_mode='order_based_only')
    AND EXISTS(SELECT 1 FROM public.historical_manual_access_dispatch WHERE agreement_id=a.id) THEN
    SELECT paid_at INTO start_at FROM public.payments_v2 WHERE id=a.first_payment_id AND order_id=o.id
      AND status::text='succeeded' AND NOT coalesce(is_deleted,false) AND coalesce(refunded_amount,0)=0;
    SELECT coalesce(nullif(o.purchase_snapshot->>'access_days','')::integer,t.access_days) INTO days
      FROM public.tariffs t WHERE t.id=o.tariff_id AND t.product_id=o.product_id;
    end_at:=start_at+make_interval(days=>days);
    IF start_at IS NULL OR days IS NULL OR days<=0 OR days>3660 OR end_at<=now()
      OR EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE order_id=o.id)
      OR (SELECT count(*) FROM public.entitlements e WHERE e.order_id=o.id AND e.user_id=o.user_id
        AND e.product_id=o.product_id AND e.status::text='active' AND e.expires_at>=end_at)<>1 THEN
      RETURN jsonb_build_object('state','unknown','reason','grant_readback_incomplete');
    END IF;
    RETURN jsonb_build_object('state','complete','existing',false,'entitlement_only',true);
  END IF;
  SELECT count(*) INTO n FROM public.subscriptions_v2 WHERE order_id=o.id;
  IF n>1 THEN RAISE EXCEPTION 'historical_manual_access_ambiguous'; END IF;
  SELECT * INTO s FROM public.subscriptions_v2 WHERE order_id=o.id;
  IF FOUND THEN
    IF s.user_id IS DISTINCT FROM o.user_id OR s.product_id IS DISTINCT FROM o.product_id
      OR s.tariff_id IS DISTINCT FROM o.tariff_id THEN RAISE EXCEPTION 'historical_manual_access_mismatch'; END IF;
    IF EXISTS(SELECT 1 FROM public.historical_manual_access_dispatch WHERE agreement_id=a.id) THEN
      SELECT paid_at INTO start_at FROM public.payments_v2 WHERE id=a.first_payment_id;
      SELECT coalesce(nullif(o.purchase_snapshot->>'access_days','')::integer,t.access_days) INTO days
        FROM public.tariffs t WHERE t.id=o.tariff_id AND t.product_id=o.product_id;
      end_at:=start_at+make_interval(days=>days);
      IF days IS NULL OR s.status::text<>'active' OR s.access_end_at IS NULL OR s.access_end_at<end_at
        OR NOT EXISTS(SELECT 1 FROM public.entitlements e WHERE e.order_id=o.id AND e.user_id=o.user_id
          AND e.product_id=o.product_id AND e.status::text='active' AND e.expires_at>=end_at) THEN
        RETURN jsonb_build_object('state','unknown','reason','grant_readback_incomplete');
      END IF;
      RETURN jsonb_build_object('state','complete','existing',false,'subscription_id',s.id);
    END IF;
    -- Existing rights, including a historical expiry, are preserved exactly.
    RETURN jsonb_build_object('state','complete','existing',true,'subscription_id',s.id);
  END IF;
  SELECT paid_at INTO start_at FROM public.payments_v2 WHERE id=a.first_payment_id AND order_id=o.id
    AND status::text='succeeded' AND NOT coalesce(is_deleted,false) AND coalesce(refunded_amount,0)=0;
  SELECT coalesce(nullif(o.purchase_snapshot->>'access_days','')::integer,t.access_days) INTO days
    FROM public.tariffs t WHERE t.id=o.tariff_id AND t.product_id=o.product_id;
  IF start_at IS NULL OR days IS NULL OR days<=0 OR days>3660 THEN RAISE EXCEPTION 'historical_manual_access_terms_missing'; END IF;
  end_at:=start_at+make_interval(days=>days);
  IF end_at<=now() THEN RAISE EXCEPTION 'historical_manual_access_expired'; END IF;
  IF EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE user_id=o.user_id AND product_id=o.product_id
    AND status::text IN ('active','trial')) THEN RAISE EXCEPTION 'historical_manual_other_access_present'; END IF;
  INSERT INTO public.historical_manual_access_dispatch(agreement_id) VALUES(a.id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n=0 THEN RETURN jsonb_build_object('state','unknown','reason','grant_already_dispatched'); END IF;
  INSERT INTO public.audit_logs(actor_type,actor_user_id,action,target_user_id,entity_type,entity_id,meta)
    VALUES('user',p_actor_id,'installment.historical_manual_access_dispatched',o.user_id,'orders_v2',o.id,
      jsonb_build_object('agreement_id',a.id,'start_at',start_at,'access_days',days,'expected_end_at',end_at,'provider_calls',0));
  RETURN jsonb_build_object('state','claimed','start_at',start_at,'access_days',days,'expected_end_at',end_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_claim_historical_manual_access_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_historical_manual_access_v1(uuid,uuid,uuid) TO service_role;
