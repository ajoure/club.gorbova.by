-- Only the canonical admin writer calls this RPC, after payments:edit RBAC.
-- No provider request, financial fact, access grant, order or subscription INSERT.
CREATE OR REPLACE FUNCTION public.create_existing_installment_payment_link_v1(
  p_actor_id uuid, p_order_id uuid, p_sub_id uuid,
  p_order_updated_at timestamptz, p_sub_updated_at timestamptz,
  p_expected_payments jsonb, p_expected_providers jsonb,
  p_quote jsonb, p_token text, p_request_id uuid, p_reason text, p_replace_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '3s' SET statement_timeout = '15s'
AS $$
DECLARE
  v_order public.orders_v2%ROWTYPE;
  v_sub public.subscriptions_v2%ROWTYPE;
  v_existing public.payment_links%ROWTYPE;
  v_link public.payment_links%ROWTYPE;
  v_total numeric;
  v_paid numeric;
  v_count integer;
  v_schedule_total bigint;
  v_first bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'repayment_service_only'; END IF;
  IF p_actor_id IS NULL OR public.has_admin_section_access(p_actor_id, 'payments', 'edit') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'repayment_forbidden';
  END IF;
  SELECT * INTO v_order FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO v_sub FROM public.subscriptions_v2 WHERE id=p_sub_id FOR UPDATE;
  IF v_order.id IS NULL OR v_sub.id IS NULL OR v_sub.order_id IS DISTINCT FROM v_order.id
    OR v_sub.user_id IS DISTINCT FROM v_order.user_id OR v_sub.product_id IS DISTINCT FROM v_order.product_id
    OR v_sub.tariff_id IS DISTINCT FROM v_order.tariff_id OR v_order.user_id IS NULL
    OR v_order.status::text NOT IN ('paid','partial') OR v_order.currency <> 'BYN'
    OR v_order.meta->'installment'->>'model' IS DISTINCT FROM 'bepaid_finite_subscription'
    OR v_order.meta->'installment'->>'original_order_id' IS DISTINCT FROM p_order_id::text THEN
    RAISE EXCEPTION 'repayment_identity_mismatch';
  END IF;
  -- Retry the same create request without generating a second customer link.
  SELECT * INTO v_existing FROM public.payment_links
    WHERE meta->'repayment'->>'request_id'=p_request_id::text
      AND meta->'repayment'->>'original_order_id'=p_order_id::text LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by IS DISTINCT FROM p_actor_id
      OR v_existing.meta->'repayment'->>'fingerprint' IS DISTINCT FROM p_quote->>'fingerprint'
      OR v_existing.meta->'repayment'->'schedule_minor' IS DISTINCT FROM p_quote->'schedule_minor'
      OR v_existing.meta->'repayment'->>'payment_type' IS DISTINCT FROM p_quote->>'payment_type'
      OR v_existing.meta->'repayment'->>'interval_days' IS DISTINCT FROM p_quote->>'interval_days' THEN
      RAISE EXCEPTION 'repayment_request_conflict';
    END IF;
    RETURN jsonb_build_object('payment_link_id',v_existing.id,'public_url',v_existing.public_url,'reused',true);
  END IF;
  IF v_order.updated_at IS DISTINCT FROM p_order_updated_at OR v_sub.updated_at IS DISTINCT FROM p_sub_updated_at THEN
    RAISE EXCEPTION 'repayment_quote_changed';
  END IF;
  PERFORM id FROM public.provider_subscriptions WHERE subscription_v2_id=p_sub_id ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.provider_subscriptions WHERE subscription_v2_id=p_sub_id;
  IF v_count <> jsonb_array_length(p_expected_providers) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_expected_providers) AS x(id uuid,updated_at timestamptz)
      LEFT JOIN public.provider_subscriptions p ON p.id=x.id AND p.subscription_v2_id=p_sub_id AND p.updated_at=x.updated_at
      WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION 'repayment_quote_changed'; END IF;
  PERFORM id FROM public.payments_v2 WHERE order_id=p_order_id ORDER BY id FOR SHARE;
  SELECT count(*) INTO v_count FROM public.payments_v2 WHERE order_id=p_order_id;
  IF v_count <> jsonb_array_length(p_expected_payments) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_expected_payments) AS x(id uuid,updated_at timestamptz)
      LEFT JOIN public.payments_v2 p ON p.id=x.id AND p.order_id=p_order_id AND p.updated_at=x.updated_at
      WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION 'repayment_quote_changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments_v2 WHERE order_id=p_order_id AND NOT is_deleted
    AND (coalesce(refunded_amount,0)>0 OR status::text IN ('refunded','partially_refunded'))) THEN
    RAISE EXCEPTION 'repayment_refund_requires_review';
  END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM (
    SELECT DISTINCT ON (provider,coalesce(provider_payment_id,id::text)) amount
    FROM public.payments_v2 WHERE order_id=p_order_id AND NOT is_deleted AND status::text='succeeded'
    ORDER BY provider,coalesce(provider_payment_id,id::text),id
  ) paid;
  v_total := (v_order.meta->'installment'->>'effective_total_byn')::numeric;
  SELECT sum(value::bigint), count(*) INTO v_schedule_total,v_count FROM jsonb_array_elements_text(p_quote->'schedule_minor');
  v_first := (p_quote->'schedule_minor'->>0)::bigint;
  IF v_paid<=0 OR v_paid>=v_total OR v_count NOT BETWEEN 1 AND 60 OR v_first<100
    OR v_schedule_total IS DISTINCT FROM ((v_total-v_paid)*100)::bigint
    OR (p_quote->>'paid_minor')::bigint IS DISTINCT FROM (v_paid*100)::bigint
    OR p_quote->>'original_order_id' IS DISTINCT FROM p_order_id::text
    OR p_quote->>'subscription_v2_id' IS DISTINCT FROM p_sub_id::text
    OR p_quote->>'payment_type' NOT IN ('one_time','subscription')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_quote->'schedule_minor') n WHERE n.value::bigint<100) THEN
    RAISE EXCEPTION 'repayment_invalid_quote';
  END IF;
  IF p_quote->>'payment_type'='subscription' AND (
    v_count<2 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_quote->'schedule_minor') n
      WHERE n.value::bigint IS DISTINCT FROM v_first
    )
  ) THEN
    RAISE EXCEPTION 'repayment_autopay_requires_equal_payments';
  END IF;
  IF EXISTS (SELECT 1 FROM public.provider_subscriptions WHERE subscription_v2_id=p_sub_id
    AND state NOT IN ('canceled','cancelled','failed','expired','completed','terminated'))
    AND p_replace_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'repayment_mandate_confirmation_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_links WHERE meta->'repayment'->>'original_order_id'=p_order_id::text
    AND status='active' AND (expires_at IS NULL OR expires_at>now())) THEN
    RAISE EXCEPTION 'repayment_active_link_exists';
  END IF;
  IF length(p_reason) NOT BETWEEN 1 AND 1000 OR p_token !~ '^[a-f0-9]{48}$' THEN RAISE EXCEPTION 'repayment_invalid_request'; END IF;
  INSERT INTO public.payment_links (user_id,product_id,tariff_id,amount,currency,payment_type,provider,provider_mode,
    status,url_token,public_url,max_uses,expires_at,created_by,responsible_user_id,description,meta)
  VALUES (v_order.user_id,v_order.product_id,v_order.tariff_id,v_first,'BYN',p_quote->>'payment_type','bepaid','fixed',
    'active',p_token,'https://gorbova.by/pay/'||p_token,1,now()+interval '7 days',p_actor_id,v_order.responsible_user_id,
    'Доплата по существующей рассрочке',jsonb_build_object('allowed_payment_providers',jsonb_build_array('bepaid'),
      'repayment',p_quote||jsonb_build_object('request_id',p_request_id,'reason',p_reason,'replace_mandate_confirmed',p_replace_confirmed,'checkout_state','draft')))
  RETURNING * INTO v_link;
  INSERT INTO public.audit_logs(actor_type,actor_user_id,action,target_user_id,meta)
  VALUES ('user',p_actor_id,'installment.repayment_link_created',v_order.user_id,jsonb_build_object(
    'order_id',p_order_id,'subscription_v2_id',p_sub_id,'payment_link_id',v_link.id,'request_id',p_request_id,
    'paid_minor',(v_paid*100)::bigint,'remaining_minor',v_schedule_total,'schedule_minor',p_quote->'schedule_minor',
    'reason',p_reason,'new_orders',0,'new_subscriptions',0,'provider_calls',0));
  RETURN jsonb_build_object('payment_link_id',v_link.id,'public_url',v_link.public_url,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.create_existing_installment_payment_link_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb,text,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_existing_installment_payment_link_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb,text,uuid,text,boolean) TO service_role;