-- Historical owner-confirmed two-part agreements only. No new purchase,
-- receipt, mandate, access or provider request is created by this transaction.
CREATE TABLE public.historical_manual_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders_v2(id),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  user_id uuid NOT NULL,
  first_payment_id uuid NOT NULL REFERENCES public.payments_v2(id),
  total_byn numeric(12,2) NOT NULL CHECK(total_byn>0),
  per_payment_byn numeric(12,2) NOT NULL CHECK(per_payment_byn>0),
  interval_days integer NOT NULL CHECK(interval_days BETWEEN 0 AND 366),
  second_due_at timestamptz NOT NULL,
  due_basis text GENERATED ALWAYS AS (CASE WHEN interval_days=0 THEN 'recovery_now' ELSE 'first_payment_interval' END) STORED,
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),
  created_by uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.historical_manual_installments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_manual_installments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.historical_manual_installments TO service_role,authenticated;
CREATE POLICY historical_manual_staff_read ON public.historical_manual_installments
  FOR SELECT TO authenticated USING(public.has_admin_section_access(auth.uid(),'payments','edit'));

CREATE FUNCTION public.historical_manual_agreement_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'historical_manual_agreement_immutable'; END $$;
CREATE TRIGGER historical_manual_agreement_immutable BEFORE UPDATE OR DELETE
  ON public.historical_manual_installments FOR EACH ROW EXECUTE FUNCTION public.historical_manual_agreement_immutable();
REVOKE ALL ON FUNCTION public.historical_manual_agreement_immutable() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_historical_manual_installment_v1(
  p_actor_id uuid,p_profile_id uuid,p_order_id uuid,p_first_payment_id uuid,
  p_total_byn numeric,p_interval_days integer,p_reason text,p_request_id uuid,
  p_confirm boolean DEFAULT false,p_expected_fingerprint text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE o public.orders_v2%ROWTYPE; first_payment public.payments_v2%ROWTYPE;
  existing public.historical_manual_installments%ROWTYPE; agreement public.historical_manual_installments%ROWTYPE;
  receipt_count integer; paid numeric; fingerprint text; terms jsonb; payments jsonb; resolved_due_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor_id IS NULL
    OR public.has_admin_section_access(p_actor_id,'payments','edit') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'historical_manual_forbidden';
  END IF;
  IF p_request_id IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000
    OR p_interval_days IS NULL OR p_interval_days NOT BETWEEN 0 AND 366
    OR p_total_byn IS NULL OR p_total_byn<=0 OR p_total_byn<>round(p_total_byn,2) THEN
    RAISE EXCEPTION 'historical_manual_invalid_terms';
  END IF;
  SELECT * INTO o FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR coalesce(o.is_deleted,false) OR o.profile_id IS DISTINCT FROM p_profile_id
    OR o.user_id IS NULL OR o.product_id IS NULL OR o.tariff_id IS NULL OR o.currency<>'BYN'
    OR o.status::text NOT IN ('paid','partial')
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile_id AND user_id=o.user_id) THEN
    RAISE EXCEPTION 'historical_manual_identity_mismatch';
  END IF;
  SELECT * INTO existing FROM public.historical_manual_installments WHERE order_id=o.id;
  IF FOUND THEN
    IF existing.first_payment_id IS DISTINCT FROM p_first_payment_id OR existing.total_byn IS DISTINCT FROM p_total_byn
      OR existing.interval_days IS DISTINCT FROM p_interval_days OR existing.reason IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'historical_manual_agreement_conflict';
    END IF;
    RETURN jsonb_build_object('success',true,'confirmed',true,'reused',true,'agreement_id',existing.id,'order_id',o.id,
      'total_byn',existing.total_byn,'paid_byn',o.paid_amount,'remaining_byn',existing.total_byn-o.paid_amount,
      'second_due_at',existing.second_due_at,'due_basis',existing.due_basis);
  END IF;
  IF o.meta ? 'installment' OR o.meta ? 'installment_progress' OR o.payment_plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'historical_manual_existing_agreement';
  END IF;
  IF EXISTS(SELECT 1 FROM public.provider_subscriptions ps LEFT JOIN public.subscriptions_v2 s ON s.id=ps.subscription_v2_id
    WHERE (ps.order_id=o.id OR s.order_id=o.id)) THEN
    RAISE EXCEPTION 'historical_manual_provider_present';
  END IF;
  IF EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE order_id=o.id AND auto_renew IS TRUE) THEN
    RAISE EXCEPTION 'historical_manual_autorenew_present';
  END IF;
  PERFORM id FROM public.payments_v2 WHERE order_id=o.id ORDER BY id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id=o.id AND NOT coalesce(is_deleted,false)
    AND (status::text IN ('pending','processing','refunded','partially_refunded') OR coalesce(refunded_amount,0)<>0)) THEN
    RAISE EXCEPTION 'historical_manual_payment_requires_review';
  END IF;
  SELECT * INTO first_payment FROM public.payments_v2 WHERE id=p_first_payment_id AND order_id=o.id
    AND profile_id=o.profile_id AND user_id=o.user_id AND currency=o.currency AND status::text='succeeded'
    AND NOT coalesce(is_deleted,false) AND coalesce(refunded_amount,0)=0
    AND coalesce(transaction_type,'payment') IN ('payment','capture','Платеж','Платёж') AND amount>0 AND paid_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'historical_manual_first_receipt_missing'; END IF;
  SELECT count(*),sum(amount),jsonb_agg(jsonb_build_object('id',id,'amount',amount,'status',status,'updated_at',updated_at) ORDER BY id)
    INTO receipt_count,paid,payments FROM public.payments_v2 WHERE order_id=o.id AND NOT coalesce(is_deleted,false)
      AND status::text='succeeded' AND coalesce(transaction_type,'payment') IN ('payment','capture','Платеж','Платёж');
  IF receipt_count<>1 OR paid<>first_payment.amount OR o.paid_amount<>paid OR p_total_byn<>2*paid
    OR o.final_price NOT IN (paid,p_total_byn) THEN RAISE EXCEPTION 'historical_manual_balance_mismatch'; END IF;
  resolved_due_at:=CASE WHEN p_interval_days=0 THEN date_trunc('day',now() AT TIME ZONE 'Europe/Minsk') AT TIME ZONE 'Europe/Minsk'
    ELSE first_payment.paid_at+make_interval(days=>p_interval_days) END;
  terms:=jsonb_build_object('model','historical_manual_installment','infinite',false,'original_order_id',o.id,
    'billing_cycles',2,'per_payment_byn',paid,'effective_total_byn',p_total_byn,'interval_days',p_interval_days,
    'first_payment_id',first_payment.id,'due_basis',CASE WHEN p_interval_days=0 THEN 'recovery_now' ELSE 'first_payment_interval' END,'second_due_at',resolved_due_at);
  fingerprint:=md5(jsonb_build_object('order',to_jsonb(o),'payments',payments,'terms',terms,'reason',trim(p_reason))::text);
  IF NOT p_confirm THEN RETURN jsonb_build_object('success',true,'confirmed',false,'fingerprint',fingerprint,
    'order_id',o.id,'total_byn',p_total_byn,'paid_byn',paid,'remaining_byn',p_total_byn-paid,
    'second_due_at',terms->'second_due_at','due_basis',terms->'due_basis','new_orders',0,'new_payments',0,'provider_calls',0); END IF;
  IF p_expected_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'historical_manual_quote_changed'; END IF;
  INSERT INTO public.historical_manual_installments(order_id,profile_id,user_id,first_payment_id,total_byn,per_payment_byn,
    interval_days,second_due_at,reason,created_by,request_id)
    VALUES(o.id,o.profile_id,o.user_id,first_payment.id,p_total_byn,paid,p_interval_days,
      resolved_due_at,trim(p_reason),p_actor_id,p_request_id) RETURNING * INTO agreement;
  UPDATE public.orders_v2 SET base_price=p_total_byn,final_price=p_total_byn,status='partial',
    meta=coalesce(meta,'{}')||jsonb_build_object('installment',terms,'historical_manual_agreement_id',agreement.id)
    WHERE id=o.id;
  INSERT INTO public.audit_logs(actor_type,actor_user_id,action,target_user_id,entity_type,entity_id,meta)
    VALUES('user',p_actor_id,'installment.historical_manual_confirmed',o.user_id,'orders_v2',o.id,
      jsonb_build_object('agreement_id',agreement.id,'request_id',p_request_id,'reason',trim(p_reason),
        'old_total',o.final_price,'total',p_total_byn,'first_payment_id',first_payment.id,'paid',paid,'remaining',p_total_byn-paid,
        'new_orders',0,'new_payments',0,'provider_calls',0,'access_changed',false));
  RETURN jsonb_build_object('success',true,'confirmed',true,'reused',false,'agreement_id',agreement.id,'order_id',o.id,
    'total_byn',p_total_byn,'paid_byn',paid,'remaining_byn',p_total_byn-paid,'second_due_at',agreement.second_due_at,'due_basis',agreement.due_basis);
END $$;
REVOKE ALL ON FUNCTION public.admin_historical_manual_installment_v1(uuid,uuid,uuid,uuid,numeric,integer,text,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_historical_manual_installment_v1(uuid,uuid,uuid,uuid,numeric,integer,text,uuid,boolean,text) TO service_role;

-- The side-effect boundary has a separate durable single-dispatch state.
-- No timeout releases an uncertain grant. Re-entry only reads actual rights.
CREATE TABLE public.historical_manual_access_dispatch (
  agreement_id uuid PRIMARY KEY REFERENCES public.historical_manual_installments(id),
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.historical_manual_access_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_manual_access_dispatch FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.historical_manual_access_dispatch TO service_role;
CREATE FUNCTION public.admin_claim_historical_manual_access_v1(p_actor_id uuid,p_order_id uuid,p_profile_id uuid)
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

-- Called only by the authenticated canonical bePaid webhook, after signature
-- verification. The provider money fact and consumption of this exact debt link
-- commit together. Never rebind an existing provider UID or grant access.
CREATE FUNCTION public.record_historical_manual_repayment_v1(
  p_link_id uuid,p_provider_uid text,p_amount_minor bigint,p_currency text,p_paid_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE link public.payment_links%ROWTYPE; o public.orders_v2%ROWTYPE;
  a public.historical_manual_installments%ROWTYPE; receipt public.payments_v2%ROWTYPE;
  prior public.payments_v2%ROWTYPE; paid numeric; recalculated jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'historical_manual_forbidden'; END IF;
  IF length(coalesce(p_provider_uid,'')) NOT BETWEEN 1 AND 256 OR p_currency IS DISTINCT FROM 'BYN'
    OR p_amount_minor IS NULL OR p_amount_minor<100 OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'historical_manual_invalid_receipt'; END IF;
  SELECT * INTO link FROM public.payment_links WHERE id=p_link_id;
  IF NOT FOUND OR link.meta->'repayment'->>'agreement_model' IS DISTINCT FROM 'historical_manual_installment'
    OR link.payment_type IS DISTINCT FROM 'one_time' OR link.provider IS DISTINCT FROM 'bepaid'
    OR link.currency IS DISTINCT FROM 'BYN' OR link.amount IS DISTINCT FROM p_amount_minor::numeric THEN
    RAISE EXCEPTION 'historical_manual_link_mismatch'; END IF;
  SELECT * INTO o FROM public.orders_v2 WHERE id=(link.meta->'repayment'->>'original_order_id')::uuid FOR UPDATE;
  SELECT * INTO a FROM public.historical_manual_installments WHERE order_id=o.id;
  IF a.id IS NULL OR a.user_id IS DISTINCT FROM o.user_id OR link.user_id IS DISTINCT FROM o.user_id
    OR o.profile_id IS DISTINCT FROM a.profile_id OR coalesce(o.is_deleted,false)
    OR o.meta->>'historical_manual_agreement_id' IS DISTINCT FROM a.id::text THEN
    RAISE EXCEPTION 'historical_manual_identity_mismatch'; END IF;
  -- Lock the link only after the order, matching the canonical link writer.
  SELECT * INTO link FROM public.payment_links WHERE id=p_link_id FOR UPDATE;
  SELECT * INTO prior FROM public.payments_v2 WHERE provider='bepaid' AND provider_payment_id=p_provider_uid;
  IF FOUND THEN
    IF prior.order_id IS DISTINCT FROM o.id OR prior.amount IS DISTINCT FROM p_amount_minor::numeric/100
      OR prior.currency IS DISTINCT FROM p_currency OR prior.status::text<>'succeeded'
      OR prior.meta->>'historical_manual_repayment_link_id' IS DISTINCT FROM link.id::text THEN
      RAISE EXCEPTION 'historical_manual_receipt_conflict'; END IF;
    RETURN jsonb_build_object('success',true,'reused',true,'payment_id',prior.id,'changes_access',false);
  END IF;
  IF link.status IS DISTINCT FROM 'active' OR link.meta->'repayment'->>'checkout_state' IS DISTINCT FROM 'ready'
    OR o.status::text NOT IN ('partial','paid') THEN RAISE EXCEPTION 'historical_manual_link_not_ready'; END IF;
  PERFORM id FROM public.payments_v2 WHERE order_id=o.id ORDER BY id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id=o.id AND NOT coalesce(is_deleted,false)
    AND (status::text IN ('pending','processing','refunded','partially_refunded') OR coalesce(refunded_amount,0)<>0)) THEN
    RAISE EXCEPTION 'historical_manual_payment_requires_review'; END IF;
  SELECT coalesce(sum(amount),0) INTO paid FROM public.payments_v2 WHERE order_id=o.id AND NOT coalesce(is_deleted,false)
    AND status::text='succeeded' AND coalesce(transaction_type,'payment') IN ('payment','capture','Платеж','Платёж');
  IF paid<>a.per_payment_byn OR p_amount_minor IS DISTINCT FROM ((a.total_byn-paid)*100)::bigint THEN
    RAISE EXCEPTION 'historical_manual_balance_mismatch'; END IF;
  INSERT INTO public.payments_v2(order_id,user_id,profile_id,amount,currency,status,provider,provider_payment_id,paid_at,
    origin,transaction_type,is_recurring,meta)
    VALUES(o.id,o.user_id,o.profile_id,p_amount_minor::numeric/100,'BYN','succeeded','bepaid',p_provider_uid,p_paid_at,
      'bepaid','payment',false,jsonb_build_object('source','historical_manual_repayment','historical_manual_repayment_link_id',link.id,
        'payment_origin_detail','installment_repayment','repayment',true,'changes_access',false)) RETURNING * INTO receipt;
  recalculated:=public.recalc_order_totals(o.id,'payment_added',receipt.id);
  IF (recalculated->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'historical_manual_recalc_failed'; END IF;
  UPDATE public.payment_links SET status='completed',current_uses=1,
    meta=meta||jsonb_build_object('repayment',(meta->'repayment')||jsonb_build_object('checkout_state','paid',
      'last_provider_payment_uid',p_provider_uid,'remaining_minor_after',0)) WHERE id=link.id;
  INSERT INTO public.audit_logs(actor_type,action,target_user_id,entity_type,entity_id,meta)
    VALUES('system','installment.historical_manual_repayment_recorded',o.user_id,'orders_v2',o.id,
      jsonb_build_object('agreement_id',a.id,'payment_id',receipt.id,'payment_link_id',link.id,'amount_minor',p_amount_minor,
        'remaining_minor',0,'new_orders',0,'access_changed',false,'provider_calls',0));
  RETURN jsonb_build_object('success',true,'reused',false,'payment_id',receipt.id,'remaining_minor',0,'changes_access',false);
END $$;
REVOKE ALL ON FUNCTION public.record_historical_manual_repayment_v1(uuid,text,bigint,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_historical_manual_repayment_v1(uuid,text,bigint,text,timestamptz) TO service_role;

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
    OR coalesce(v_order.meta->'installment'->>'model','') NOT IN ('bepaid_finite_subscription','historical_manual_installment')
    OR v_order.meta->'installment'->>'original_order_id' IS DISTINCT FROM p_order_id::text THEN
    RAISE EXCEPTION 'repayment_identity_mismatch';
  END IF;
  IF v_order.meta->'installment'->>'model'='historical_manual_installment' THEN
    IF p_quote->>'agreement_model' IS DISTINCT FROM 'historical_manual_installment' THEN
      RAISE EXCEPTION 'historical_manual_quote_model_mismatch'; END IF;
    IF p_quote->>'payment_type' IS DISTINCT FROM 'one_time' OR p_quote->>'replaces_provider_subscription_id' IS NOT NULL
      OR jsonb_array_length(p_quote->'schedule_minor')<>1
      THEN RAISE EXCEPTION 'historical_manual_single_repayment_only'; END IF;
    IF EXISTS(SELECT 1 FROM public.provider_subscriptions WHERE order_id=p_order_id OR subscription_v2_id=p_sub_id) THEN
      RAISE EXCEPTION 'historical_manual_provider_present'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.historical_manual_installments a WHERE a.order_id=p_order_id
        AND a.id::text=v_order.meta->>'historical_manual_agreement_id' AND a.user_id=v_order.user_id
        AND a.profile_id=v_order.profile_id AND a.total_byn=(v_order.meta->'installment'->>'effective_total_byn')::numeric
        AND a.first_payment_id::text=v_order.meta->'installment'->>'first_payment_id') THEN
      RAISE EXCEPTION 'historical_manual_agreement_mismatch';
    END IF;
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
