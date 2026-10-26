-- Keep manual-period lookup bounded on the large audit ledger. The predicate
-- also covers admin-ui events whose order ID lives only in meta.
SET lock_timeout = '3s';
SET statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS idx_audit_logs_manual_period_order
  ON public.audit_logs ((coalesce(meta->>'order_id',CASE WHEN entity_type='orders_v2' THEN entity_id END)))
  WHERE action IN ('deal.deal_date.updated','deal.deal_month.updated');
RESET lock_timeout;
RESET statement_timeout;

-- No historical backfill. Money and its effective purchase are committed in
-- one transaction; provider requests and access delivery remain outside SQL.
CREATE OR REPLACE FUNCTION public.crm_settle_one_time_receipt(p_order_id uuid,p_payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  source public.orders_v2%ROWTYPE;
  target public.orders_v2%ROWTYPE;
  receipt public.payments_v2%ROWTYPE;
  proposed public.payments_v2%ROWTYPE;
  account_code text := coalesce(p_payment#>>'{meta,stripe,account_code}','');
  prior_count integer;
  prior_gross numeric;
  is_split boolean := false;
  is_installment boolean;
  child_meta jsonb;
BEGIN
  proposed := jsonb_populate_record(NULL::public.payments_v2,p_payment);
  IF proposed.provider NOT IN ('bepaid','stripe') OR proposed.provider IS NULL
    OR nullif(btrim(proposed.provider_payment_id),'') IS NULL
    OR proposed.amount IS NULL OR proposed.amount<=0 OR proposed.paid_at IS NULL
    OR proposed.status::text<>'succeeded' OR proposed.status IS NULL
    OR coalesce(proposed.transaction_type,'payment') NOT IN ('payment','sale','capture','Платеж')
    OR coalesce(p_payment->>'payment_classification','') IN ('card_verification','fee','external','refund')
    OR coalesce(proposed.refunded_amount,0)<>0
    OR (proposed.provider='bepaid' AND p_payment#>>'{provider_response,status}'='authorized')
    OR (proposed.provider='stripe' AND account_code='') THEN
    RAISE EXCEPTION 'invalid_purchase_receipt';
  END IF;
  -- Receipt lock always precedes the source-order lock, including retries.
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase_receipt:'||proposed.provider||':'||account_code||':'||proposed.provider_payment_id,0));
  SELECT * INTO source FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase_missing'; END IF;
  SELECT * INTO receipt FROM public.payments_v2
    WHERE provider=proposed.provider AND provider_payment_id=proposed.provider_payment_id
      AND coalesce(meta#>>'{stripe,account_code}','')=account_code FOR UPDATE;
  IF FOUND AND receipt.status::text IN ('succeeded','refunded','partially_refunded') THEN
    SELECT * INTO target FROM public.orders_v2 WHERE id=receipt.order_id;
    IF target.id IS NULL OR (target.id<>p_order_id AND target.meta->>'receipt_parent_order_id' IS DISTINCT FROM p_order_id::text)
      OR receipt.amount IS DISTINCT FROM proposed.amount
      OR upper(receipt.currency) IS DISTINCT FROM upper(proposed.currency)
      OR target.user_id IS DISTINCT FROM source.user_id OR target.product_id IS DISTINCT FROM source.product_id
      OR target.tariff_id IS DISTINCT FROM source.tariff_id OR target.profile_id IS DISTINCT FROM source.profile_id
      OR coalesce(target.is_deleted,false)
      OR (proposed.provider='stripe' AND receipt.meta#>>'{stripe,invoice_id}' IS DISTINCT FROM p_payment#>>'{meta,stripe,invoice_id}')
      OR coalesce(receipt.is_deleted,false) THEN
      RAISE EXCEPTION 'receipt_already_settled_elsewhere';
    END IF;
    -- Inline recovery may have persisted the first receipt immediately before
    -- this webhook continued. Finish only the proven system period stamp;
    -- money/status already match and no other principal receipt may exist.
    IF target.id=p_order_id AND receipt.status::text='succeeded'
      AND target.paid_amount=receipt.amount
      AND target.meta->>'payment_flow' IN ('renewal_one_time','renewal_subscription')
      AND NOT EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=target.id AND p.id<>receipt.id
        AND NOT coalesce(p.is_deleted,false) AND p.amount>0
        AND p.status::text IN ('succeeded','refunded','partially_refunded')
        AND coalesce(p.transaction_type,'payment') IN ('payment','sale','capture','Платеж')) THEN
      PERFORM public.crm_refresh_paid_purchase(target.id);
    END IF;
    RETURN jsonb_build_object('order_id',target.id,'payment_id',receipt.id,'duplicate',true,
      'split',target.id<>p_order_id,'access_allowed',receipt.status::text='succeeded' AND coalesce(receipt.refunded_amount,0)=0
        AND target.status::text NOT IN ('refunded','canceled') AND NOT coalesce(target.meta @> '{"do_not_grant_access":true}',false));
  END IF;
  SELECT * INTO source FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR coalesce(source.is_deleted,false) OR source.user_id IS NULL
    OR source.product_id IS NULL OR source.tariff_id IS NULL
    OR upper(source.currency) IS DISTINCT FROM upper(proposed.currency)
    OR (p_payment->>'user_id' IS NOT NULL AND p_payment->>'user_id'<>source.user_id::text)
    OR (p_payment->>'profile_id' IS NOT NULL AND p_payment->>'profile_id' IS DISTINCT FROM source.profile_id::text)
    OR (receipt.id IS NOT NULL AND receipt.order_id IS NOT NULL AND receipt.order_id<>source.id)
    OR source.status::text IN ('refunded','canceled') OR source.meta @> '{"do_not_grant_access":true}'
    OR source.meta @> '{"refund_candidate":true}' THEN
    RAISE EXCEPTION 'purchase_receipt_source_mismatch';
  END IF;
  SELECT count(*),coalesce(sum(amount),0) INTO prior_count,prior_gross FROM public.payments_v2 p
    WHERE order_id=source.id AND NOT coalesce(p.is_deleted,false) AND amount>0
      AND status::text IN ('succeeded','refunded','partially_refunded')
      AND coalesce(transaction_type,'payment') IN ('payment','sale','capture','Платеж')
      AND coalesce(to_jsonb(p)->>'payment_classification','') NOT IN ('card_verification','fee','external','refund');
  is_installment := coalesce(to_jsonb(source)->>'payment_plan_id','')<>''
    OR coalesce(source.meta->>'flow','')='rr_installment'
    OR coalesce(source.meta ?| ARRAY['installment','installment_count'],false);
  IF EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=source.id AND NOT coalesce(p.is_deleted,false)
      AND p.amount>0 AND p.status::text IN ('succeeded','refunded','partially_refunded')
      AND upper(p.currency) IS DISTINCT FROM upper(source.currency))
    OR (NOT is_installment AND proposed.amount>source.final_price) THEN
    RAISE EXCEPTION 'receipt_money_history_requires_review';
  END IF;
  target:=source;
  IF NOT is_installment AND prior_count>0 AND prior_gross>=source.final_price THEN
    -- Only proven one-time purchases use this path. Provider-managed rebills
    -- retain their canonical subscription state machine.
    IF proposed.provider<>'stripe' AND coalesce(source.meta#>>'{checkout_purchase_identity,context,kind}','')<>'one_time'
      AND coalesce(source.meta->>'payment_flow','')<>'renewal_one_time' THEN
      RAISE EXCEPTION 'receipt_requires_canonical_subscription_settlement';
    END IF;
    IF proposed.amount IS DISTINCT FROM source.final_price OR source.final_price<=0
      OR coalesce(jsonb_array_length(source.meta#>'{composable_checkout,items}'),0)>1
      OR source.meta ? 'contractual_month'
      OR EXISTS(SELECT 1 FROM public.payments_v2 p WHERE order_id=source.id AND NOT coalesce(p.is_deleted,false)
        AND (coalesce(refunded_amount,0)>0 OR amount<0 OR status::text IN ('refunded','partially_refunded'))) THEN
      RAISE EXCEPTION 'receipt_split_requires_review';
    END IF;
    SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO child_meta
      FROM jsonb_each(coalesce(source.meta,'{}'::jsonb))
      WHERE key IN ('crm_routing_snapshot','payment_flow','product_name','tariff_name','utm','financial_kind','legal_details_id');
    child_meta:=child_meta||jsonb_build_object('receipt_parent_order_id',source.id,
      'parent_order_id',source.id,'source','new_receipt_on_paid_purchase',
      'materialized_from_payment_uid',proposed.provider_payment_id,
      'deal_month',to_char(proposed.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM'));
    IF p_payment#>'{meta,stripe}' IS NOT NULL THEN child_meta:=child_meta||jsonb_build_object('stripe',p_payment#>'{meta,stripe}'); END IF;
    INSERT INTO public.orders_v2(order_number,user_id,profile_id,product_id,tariff_id,offer_id,
      responsible_user_id,company_id,payer_type,base_price,final_price,paid_amount,currency,
      provider,provider_payment_id,deal_date,meta,pipeline_id,pipeline_stage_id,purchase_snapshot)
    VALUES(public.generate_order_number(),source.user_id,source.profile_id,source.product_id,source.tariff_id,source.offer_id,
      source.responsible_user_id,source.company_id,source.payer_type,source.base_price,source.final_price,0,upper(source.currency),
      proposed.provider,proposed.provider_payment_id,proposed.paid_at,child_meta,source.pipeline_id,source.pipeline_stage_id,source.purchase_snapshot)
    RETURNING * INTO target;
    is_split:=true;
  END IF;
  IF receipt.id IS NULL THEN
    INSERT INTO public.payments_v2(order_id,user_id,profile_id,provider,provider_payment_id,
      amount,currency,status,paid_at,transaction_type,origin,card_brand,card_last4,provider_response,receipt_url,meta)
    VALUES(target.id,source.user_id,source.profile_id,proposed.provider,proposed.provider_payment_id,
      proposed.amount,upper(proposed.currency),'succeeded',proposed.paid_at,coalesce(proposed.transaction_type,'payment'),
      proposed.origin,proposed.card_brand,proposed.card_last4,proposed.provider_response,proposed.receipt_url,coalesce(proposed.meta,'{}'::jsonb))
    RETURNING * INTO receipt;
  ELSE
    -- A pending/failed row for this UID can complete, but confirmed money is
    -- never repointed or overwritten by a retry.
    UPDATE public.payments_v2 SET order_id=target.id,user_id=source.user_id,profile_id=source.profile_id,
      amount=proposed.amount,currency=upper(proposed.currency),status='succeeded',paid_at=proposed.paid_at,
      transaction_type=coalesce(proposed.transaction_type,'payment'),
      meta=coalesce(meta,'{}'::jsonb)||coalesce(proposed.meta,'{}'::jsonb)
      WHERE id=receipt.id RETURNING * INTO receipt;
  END IF;
  IF prior_count=0 THEN
    UPDATE public.orders_v2 SET provider=proposed.provider,
      provider_payment_id=proposed.provider_payment_id WHERE id=target.id;
  END IF;
  PERFORM public.crm_refresh_paid_purchase(target.id);
  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','payment_checkout.receipt_settled','orders_v2',target.id,
      jsonb_build_object('source_order_id',source.id,'order_id',target.id,'payment_id',receipt.id,'split',is_split));
  RETURN jsonb_build_object('order_id',target.id,'payment_id',receipt.id,'duplicate',false,'split',is_split,'access_allowed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_settle_one_time_receipt(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_settle_one_time_receipt(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_refresh_paid_purchase(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE purchase public.orders_v2%ROWTYPE; gross numeric; receipt_count integer; first_paid timestamptz; stamp_period boolean;
BEGIN
  SELECT * INTO purchase FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase_missing'; END IF;
  SELECT sum(amount),count(*),min(paid_at) INTO gross,receipt_count,first_paid FROM public.payments_v2 p
    WHERE order_id=p_order_id AND NOT coalesce(is_deleted,false)
      AND upper(currency)=upper(purchase.currency) AND amount>0
      AND status::text IN ('succeeded','refunded','partially_refunded')
      AND coalesce(transaction_type,'payment') IN ('payment','sale','capture','Платеж')
      AND coalesce(to_jsonb(p)->>'payment_classification','') NOT IN ('card_verification','fee','external','refund');
  IF coalesce(gross,0)<=0 THEN RAISE EXCEPTION 'purchase_without_money'; END IF;
  -- Stamp the first actual receipt of a system reminder, including an old
  -- checkout paid after month-end. Explicit service months/manual edits win.
  stamp_period:=receipt_count=1 AND first_paid IS NOT NULL
    AND purchase.meta->>'payment_flow' IN ('renewal_one_time','renewal_subscription')
    AND coalesce(to_jsonb(purchase)->>'payment_plan_id','')=''
    AND NOT coalesce(purchase.meta ?| ARRAY['installment','installment_count','contractual_month'],false)
    AND (purchase.meta->>'renewal_period_basis'='checkout_issued_at'
      OR (purchase.meta#>>'{checkout_purchase_identity,context,month}' IS NULL
        AND purchase.meta->>'deal_month'=to_char(purchase.created_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')))
    AND NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action IN ('deal.deal_date.updated','deal.deal_month.updated')
      AND coalesce(a.meta->>'order_id',CASE WHEN a.entity_type='orders_v2' THEN a.entity_id END)=p_order_id::text);
  UPDATE public.orders_v2 SET paid_amount=greatest(coalesce(paid_amount,0),gross),
    status=CASE WHEN purchase.status='refunded' THEN 'refunded'::public.order_status
      WHEN gross>=final_price THEN 'paid'::public.order_status ELSE 'partial'::public.order_status END,
    deal_date=CASE WHEN stamp_period THEN first_paid ELSE deal_date END,
    meta=CASE WHEN stamp_period THEN coalesce(meta,'{}'::jsonb)||jsonb_build_object(
      'deal_month',to_char(first_paid AT TIME ZONE 'Europe/Minsk','YYYY-MM'),'renewal_period_basis','first_confirmed_receipt') ELSE meta END,
    is_deleted=false WHERE id=p_order_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_refresh_paid_purchase(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_refresh_paid_purchase(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_settle_stripe_invoice(
  p_order jsonb, p_pending_order_id uuid, p_payment jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  proposed public.orders_v2%ROWTYPE;
  purchase public.orders_v2%ROWTYPE;
  receipt public.payments_v2%ROWTYPE;
  invoice_id text := p_order#>>'{meta,stripe,invoice_id}';
  account_code text := p_order#>>'{meta,stripe,account_code}';
  existing_invoice boolean := false;
  settlement jsonb;
BEGIN
  proposed := jsonb_populate_record(NULL::public.orders_v2,p_order);
  IF COALESCE(invoice_id,'')='' OR COALESCE(account_code,'')=''
    OR proposed.user_id IS NULL OR proposed.product_id IS NULL
    OR proposed.paid_amount IS NULL OR proposed.paid_amount<0
    OR (p_payment->>'amount')::numeric IS DISTINCT FROM proposed.paid_amount
    OR upper(p_payment->>'currency') IS DISTINCT FROM upper(proposed.currency)
    OR p_payment->>'provider' IS DISTINCT FROM 'stripe'
    OR p_payment->>'status' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'invalid_stripe_invoice_settlement';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stripe_invoice:'||account_code||':'||invoice_id,0));
  -- The order may already carry metadata of a later real receipt. Invoice
  -- identity therefore belongs to the payment ledger, not last order.meta.
  SELECT * INTO receipt FROM public.payments_v2
    WHERE provider='stripe' AND meta#>>'{stripe,invoice_id}'=invoice_id
      AND meta#>>'{stripe,account_code}'=account_code LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('order_id',receipt.order_id,'payment_id',receipt.id,'duplicate',true); END IF;
  SELECT * INTO purchase FROM public.orders_v2
    WHERE meta#>>'{stripe,invoice_id}'=invoice_id
      AND meta#>>'{stripe,account_code}'=account_code FOR UPDATE;
  existing_invoice := FOUND;
  IF existing_invoice THEN
    SELECT * INTO receipt FROM public.payments_v2
      WHERE order_id=purchase.id AND provider='stripe'
        AND meta#>>'{stripe,invoice_id}'=invoice_id LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('order_id',purchase.id,'payment_id',receipt.id,'duplicate',true); END IF;
  ELSIF p_pending_order_id IS NOT NULL THEN
    SELECT * INTO purchase FROM public.orders_v2 WHERE id=p_pending_order_id;
    IF NOT FOUND OR purchase.user_id IS DISTINCT FROM proposed.user_id
      OR purchase.product_id IS DISTINCT FROM proposed.product_id
      OR purchase.tariff_id IS DISTINCT FROM proposed.tariff_id
      OR upper(purchase.currency) IS DISTINCT FROM upper(proposed.currency) THEN
      RAISE EXCEPTION 'stripe_pending_purchase_mismatch';
    END IF;
    IF proposed.paid_amount>0 THEN
    settlement:=public.crm_settle_one_time_receipt(purchase.id,p_payment||jsonb_build_object(
      'user_id',purchase.user_id,'profile_id',purchase.profile_id));
    UPDATE public.orders_v2 SET provider='stripe',provider_payment_id=proposed.provider_payment_id,
      meta=coalesce(meta,'{}'::jsonb)||(proposed.meta-'crm_routing_snapshot')
        ||CASE WHEN meta ? 'crm_routing_snapshot' THEN '{}'::jsonb ELSE jsonb_build_object('crm_routing_snapshot',proposed.meta->'crm_routing_snapshot') END
      WHERE id=(settlement->>'order_id')::uuid;
    RETURN settlement;
    END IF;
    -- Zero-value Stripe invoices keep their existing non-money contract.
    UPDATE public.orders_v2 SET status='paid',meta=coalesce(meta,'{}'::jsonb)||coalesce(proposed.meta,'{}'::jsonb)
      WHERE id=purchase.id;
  ELSE
    INSERT INTO public.orders_v2(user_id,product_id,tariff_id,offer_id,order_number,status,
      base_price,final_price,paid_amount,currency,provider,provider_payment_id,payer_type,meta,pipeline_id,pipeline_stage_id)
    VALUES(proposed.user_id,proposed.product_id,proposed.tariff_id,proposed.offer_id,proposed.order_number,'paid',
      proposed.base_price,proposed.final_price,proposed.paid_amount,upper(proposed.currency),'stripe',
      proposed.provider_payment_id,proposed.payer_type,proposed.meta,proposed.pipeline_id,proposed.pipeline_stage_id)
    RETURNING * INTO purchase;
  END IF;
  INSERT INTO public.payments_v2(order_id,provider,provider_payment_id,amount,currency,status,paid_at,meta)
    VALUES(purchase.id,'stripe',p_payment->>'provider_payment_id',(p_payment->>'amount')::numeric,
      upper(p_payment->>'currency'),'succeeded',COALESCE((p_payment->>'paid_at')::timestamptz,now()),p_payment->'meta')
    RETURNING * INTO receipt;
  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','payment_checkout.invoice_settled','orders_v2',purchase.id,
      jsonb_build_object('order_id',purchase.id,'payment_id',receipt.id,'invoice_id',invoice_id,'account_code',account_code));
  RETURN jsonb_build_object('order_id',purchase.id,'payment_id',receipt.id,'duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_settle_stripe_invoice(jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_settle_stripe_invoice(jsonb,uuid,jsonb) TO service_role;

-- A bounded preview and an exact hash allow an operator to repair only proven
-- reminder dates. No orders/payments/access are created by either operation.
CREATE OR REPLACE FUNCTION public.crm_preview_renewal_period(p_order_ids uuid[])
RETURNS TABLE(order_id uuid,payment_id uuid,paid_at timestamptz,amount numeric,
  old_deal_date timestamptz,old_month text,new_month text,expected_hash text,eligible boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT o.id,p.id,p.paid_at,p.amount,o.deal_date,o.meta->>'deal_month',
    to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM'),
    md5(to_jsonb(o)::text||to_jsonb(p)::text||a.attempt_count::text),
    cardinality(p_order_ids) BETWEEN 1 AND 20
      AND NOT coalesce(o.is_deleted,false) AND o.status::text='paid'
      AND o.meta->>'payment_flow'='renewal_one_time'
      AND coalesce(to_jsonb(o)->>'payment_plan_id','')=''
      AND NOT coalesce(o.meta ?| ARRAY['installment','installment_count','contractual_month'],false)
      AND o.meta#>>'{checkout_purchase_identity,context,month}' IS NULL
      AND o.meta->>'deal_month'=to_char(o.created_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
      AND o.meta->>'deal_month' IS DISTINCT FROM to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
      AND p.provider='bepaid' AND nullif(btrim(p.provider_payment_id),'') IS NOT NULL
      AND p.status::text='succeeded' AND NOT coalesce(p.is_deleted,false)
      AND p.amount=o.final_price AND p.amount=o.paid_amount AND coalesce(p.refunded_amount,0)=0
      AND p.paid_at>=o.created_at AND upper(p.currency)=upper(o.currency)
      AND coalesce(to_jsonb(p)->>'payment_classification','') NOT IN ('card_verification','fee','external','refund')
      AND a.attempt_count>0
      AND NOT EXISTS(SELECT 1 FROM public.payments_v2 q WHERE q.order_id=o.id AND q.id<>p.id
        AND NOT coalesce(q.is_deleted,false) AND (q.amount<0 OR coalesce(q.refunded_amount,0)>0
          OR (q.amount>0 AND q.status::text IN ('succeeded','refunded','partially_refunded'))))
      AND NOT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.action IN ('deal.deal_date.updated','deal.deal_month.updated')
        AND coalesce(l.meta->>'order_id',CASE WHEN l.entity_type='orders_v2' THEN l.entity_id END)=o.id::text)
  FROM public.orders_v2 o
  JOIN public.payments_v2 p ON p.order_id=o.id AND p.amount>0
    AND NOT coalesce(p.is_deleted,false)
    AND p.status::text IN ('succeeded','refunded','partially_refunded')
    AND coalesce(p.transaction_type,'payment') IN ('payment','sale','capture','Платеж')
  CROSS JOIN LATERAL(SELECT count(*) attempt_count FROM public.crm_checkout_attempts c WHERE c.order_id=o.id) a
  WHERE o.id=ANY(p_order_ids) AND cardinality(p_order_ids) BETWEEN 1 AND 20;
$$;
REVOKE ALL ON FUNCTION public.crm_preview_renewal_period(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_preview_renewal_period(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_apply_renewal_period(p_order_id uuid,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE plan record; current_order public.orders_v2%ROWTYPE;
BEGIN
  SELECT * INTO current_order FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase_missing'; END IF;
  IF current_order.meta#>>'{renewal_period_repair,expected_hash}'=p_expected_hash THEN
    RETURN jsonb_build_object('order_id',p_order_id,'updated',false,'already_applied',true);
  END IF;
  -- Lock the receipt set as well; a concurrent refund cannot race this repair.
  PERFORM 1 FROM public.payments_v2 WHERE order_id=p_order_id FOR UPDATE;
  SELECT * INTO STRICT plan FROM public.crm_preview_renewal_period(ARRAY[p_order_id]);
  IF NOT coalesce(plan.eligible,false) OR plan.expected_hash IS DISTINCT FROM p_expected_hash THEN
    RAISE EXCEPTION 'renewal_period_repair_preflight_changed';
  END IF;
  UPDATE public.orders_v2 SET deal_date=plan.paid_at,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('deal_month',plan.new_month,
      'renewal_period_repair',jsonb_build_object('expected_hash',p_expected_hash,
        'old_deal_date',plan.old_deal_date,'old_month',plan.old_month,'payment_id',plan.payment_id))
    WHERE id=p_order_id;
  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','payment_checkout.renewal_period_repaired','orders_v2',p_order_id,
      jsonb_build_object('payment_id',plan.payment_id,'old_deal_date',plan.old_deal_date,
        'old_month',plan.old_month,'new_deal_date',plan.paid_at,'new_month',plan.new_month,'expected_hash',p_expected_hash));
  RETURN jsonb_build_object('order_id',p_order_id,'updated',true,'payment_id',plan.payment_id,'deal_month',plan.new_month);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_apply_renewal_period(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_renewal_period(uuid,text) TO service_role;

