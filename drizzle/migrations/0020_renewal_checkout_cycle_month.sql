-- Renewal periods are distinct purchases. No data backfill, grants or provider calls.
-- Preserve all original serialization, money, decline and unknown-outcome guards.
CREATE OR REPLACE FUNCTION public.crm_checkout_context_from_order(o jsonb,kind text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
SELECT jsonb_build_object('kind',kind,'offer_id',o->'offer_id',
  'payer_type',CASE WHEN o->>'payer_type'='individual' THEN NULL ELSE o->>'payer_type' END,
  'company_id',o->'company_id','legal_details_id',o#>'{meta,legal_details_id}',
  'month',coalesce(nullif(o#>'{meta,deal_month}','null'::jsonb),
    CASE WHEN o#>>'{meta,payment_flow}' IN ('renewal_one_time','renewal_subscription')
      THEN to_jsonb(to_char((coalesce(nullif(o->>'deal_date',''),nullif(o->>'created_at',''))::timestamptz
        AT TIME ZONE 'Europe/Minsk'),'YYYY-MM')) END),'access_days',o#>'{purchase_snapshot,access_days}',
  'is_trial',coalesce(nullif(o->'is_trial','null'::jsonb),nullif(o#>'{purchase_snapshot,is_trial}','null'::jsonb),'false'::jsonb),
  'cohort_id',coalesce(nullif(o#>'{meta,cohort_id}','null'::jsonb),o#>'{purchase_snapshot,cohort_id}'),
  'composition',coalesce((SELECT jsonb_agg(line ORDER BY sort_key COLLATE "C") FROM (
    SELECT jsonb_build_object('product_id',i->'product_id','tariff_id',i->'tariff_id','offer_id',i->'offer_id',
      'role',i->'role','quantity',coalesce(nullif(i->'quantity','null'::jsonb),'1'::jsonb),
      'amount',coalesce(nullif(i->'final_amount','null'::jsonb),nullif(i->'final_price','null'::jsonb),i->'amount')) line,
      jsonb_build_array(i->'product_id',i->'tariff_id',i->'offer_id',i->'role',
        coalesce(nullif(i->'quantity','null'::jsonb),'1'::jsonb),
        coalesce(nullif(i->'final_amount','null'::jsonb),nullif(i->'final_price','null'::jsonb),i->'amount'))::text sort_key
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o#>'{meta,composable_checkout,items}')='array' THEN o#>'{meta,composable_checkout,items}' ELSE '[]'::jsonb END) i
    WHERE NOT coalesce((jsonb_array_length(o#>'{meta,composable_checkout,items}')=1 AND i->>'role'='primary'
      AND i->'product_id'=o->'product_id' AND i->'tariff_id'=o->'tariff_id'
      AND nullif(i->'offer_id','null'::jsonb) IS NOT DISTINCT FROM nullif(o->'offer_id','null'::jsonb)
      AND coalesce(nullif(i->'quantity','null'::jsonb),'1'::jsonb)='1'::jsonb
      AND coalesce(nullif(i->'final_amount','null'::jsonb),nullif(i->'final_price','null'::jsonb),i->'amount')=o->'final_price'),false)
  ) lines),'[]'::jsonb),
  'replacement_of_subscription_v2_id',o#>'{meta,replacement_of_subscription_v2_id}',
  'billing_cycles',coalesce(o#>'{meta,installment,billing_cycles}',o#>'{meta,installment_count}'),
  'interval_days',o#>'{meta,installment,interval_days}',
  'customer_credit',coalesce(o#>'{meta,referral_customer_credit_applied_minor}','0'::jsonb),
  'partner_bonus',coalesce(o#>'{meta,referral_partner_bonus_applied_minor}','0'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.crm_checkout_context_from_order(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_checkout_context_from_order(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_claim_pending_purchase(
  p_order jsonb, p_context jsonb, p_provider text, p_account_code text DEFAULT '', p_attempt_kind text DEFAULT 'checkout'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  proposed public.orders_v2%ROWTYPE;
  purchase public.orders_v2%ROWTYPE;
  attempt public.crm_checkout_attempts%ROWTYPE;
  identity jsonb;
  identity_key text;
BEGIN
  proposed := jsonb_populate_record(NULL::public.orders_v2, p_order);
  IF proposed.user_id IS NULL OR proposed.product_id IS NULL OR proposed.tariff_id IS NULL
    OR proposed.final_price IS NULL OR proposed.final_price <= 0
    OR proposed.currency IS NULL OR proposed.status IS DISTINCT FROM 'pending'::public.order_status
    OR COALESCE(proposed.paid_amount,0) <> 0 OR p_context IS NULL
    OR jsonb_typeof(p_context) <> 'object' OR p_context->>'kind' IS NULL
    OR p_provider NOT IN ('bepaid','stripe','rr','bank') OR p_attempt_kind NOT IN ('checkout','charge') THEN
    RAISE EXCEPTION 'invalid_checkout_purchase';
  END IF;
  identity := jsonb_build_object('version',1,'recipient',proposed.user_id,
    'product',proposed.product_id,'tariff',proposed.tariff_id,
    'currency',upper(proposed.currency),'amount',proposed.final_price,'context',p_context);
  identity_key := md5(identity::text);
  IF p_order#>>'{meta,payment_flow}' IN ('renewal_one_time','renewal_subscription') THEN
    IF p_context->>'month' IS NULL THEN RAISE EXCEPTION 'renewal_purchase_period_missing'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('crm_renewal:' || proposed.user_id::text || ':' ||
      proposed.product_id::text || ':' || proposed.tariff_id::text,0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm_purchase:' || identity_key,0));
  -- A month boundary must not turn an unresolved provider charge into a
  -- second charge. Return the old attempt without inserting a new purchase.
  IF p_order#>>'{meta,payment_flow}' IN ('renewal_one_time','renewal_subscription') THEN
    SELECT o.* INTO purchase FROM public.orders_v2 o
      JOIN public.crm_checkout_attempts a ON a.order_id=o.id
      WHERE o.user_id=proposed.user_id AND o.product_id=proposed.product_id
        AND o.tariff_id=proposed.tariff_id AND NOT coalesce(o.is_deleted,false)
        AND o.status IN ('pending','failed') AND coalesce(o.paid_amount,0)=0
        AND (a.state IN ('creating','unknown') OR (a.state='ready' AND a.attempt_kind='charge'))
      ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE OF o;
    IF FOUND THEN
      SELECT * INTO attempt FROM public.crm_checkout_attempts
        WHERE order_id=purchase.id AND
          (state IN ('creating','unknown') OR (state='ready' AND attempt_kind='charge'))
        ORDER BY created_at DESC LIMIT 1;
      -- Existing same-period ready charge keeps its original resume behavior.
      IF purchase.checkout_purchase_key IS DISTINCT FROM identity_key THEN
        RETURN jsonb_build_object('state','in_progress','order',to_jsonb(purchase),'attempt_id',attempt.id);
      END IF;
    END IF;
    purchase := NULL;
  END IF;
  SELECT * INTO purchase FROM public.orders_v2
    WHERE checkout_purchase_key = identity_key AND NOT is_deleted
      AND status IN ('pending','failed') AND COALESCE(paid_amount,0) = 0
    FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO purchase FROM public.orders_v2 o
      WHERE checkout_purchase_key IS NULL AND NOT coalesce(is_deleted,false)
        AND status IN ('pending','failed') AND coalesce(paid_amount,0)=0
        AND user_id=proposed.user_id AND product_id=proposed.product_id AND tariff_id=proposed.tariff_id
        AND offer_id IS NOT DISTINCT FROM proposed.offer_id AND final_price=proposed.final_price
        AND upper(currency)=upper(proposed.currency)
        AND public.crm_checkout_context_from_order(to_jsonb(o),
          CASE WHEN o.meta->>'flow'='rr_installment' THEN 'rr_installment'
            WHEN o.meta->>'checkout_kind'='invoice' THEN 'invoice'
            WHEN coalesce(o.meta->>'payment_type',o.meta->>'type','') LIKE '%subscription%' THEN 'subscription'
            ELSE 'one_time' END)=p_context
      ORDER BY created_at DESC,id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.orders_v2 SET checkout_purchase_key=identity_key,
        meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('checkout_purchase_identity',identity)
        WHERE id=purchase.id RETURNING * INTO purchase;
      INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
        VALUES('system','payment_checkout.legacy_purchase_adopted','orders_v2',purchase.id,jsonb_build_object('order_id',purchase.id));
    END IF;
  END IF;
  IF purchase.id IS NULL THEN
    INSERT INTO public.orders_v2 (order_number,user_id,profile_id,product_id,tariff_id,offer_id,
      responsible_user_id,company_id,base_price,final_price,paid_amount,currency,status,provider,
      customer_email,customer_phone,payer_type,reconcile_source,is_trial,trial_end_at,deal_date,meta,pipeline_id,pipeline_stage_id,purchase_snapshot,checkout_purchase_key)
    VALUES (COALESCE(proposed.order_number, public.generate_order_number()),proposed.user_id,
      proposed.profile_id,proposed.product_id,proposed.tariff_id,proposed.offer_id,
      proposed.responsible_user_id,proposed.company_id,proposed.base_price,proposed.final_price,0,
      upper(proposed.currency),'pending',p_provider,proposed.customer_email,proposed.customer_phone,
      proposed.payer_type,proposed.reconcile_source,coalesce(proposed.is_trial,false),proposed.trial_end_at,COALESCE(proposed.deal_date,now()),COALESCE(proposed.meta,'{}'::jsonb) || jsonb_build_object('checkout_purchase_identity',identity),
      proposed.pipeline_id,proposed.pipeline_stage_id,proposed.purchase_snapshot,identity_key)
    RETURNING * INTO purchase;
  END IF;
  IF purchase.final_price IS DISTINCT FROM proposed.final_price OR upper(purchase.currency) IS DISTINCT FROM upper(proposed.currency) THEN
    RAISE EXCEPTION 'checkout_purchase_price_changed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id=purchase.id AND NOT coalesce(is_deleted,false)
    AND coalesce(transaction_type,'payment') NOT IN ('tokenization','void','Отмена','authorization')
    AND status IN ('succeeded','refunded','partially_refunded') AND amount<>0) THEN
    RAISE EXCEPTION 'checkout_purchase_has_money';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=purchase.id AND NOT coalesce(p.is_deleted,false)
    AND p.status IN ('processing','pending') AND p.amount>0
    AND coalesce(p.transaction_type,'payment') NOT IN ('tokenization','void','Отмена','authorization')
    AND NOT EXISTS(SELECT 1 FROM public.crm_checkout_attempts a WHERE a.id::text=p.meta->>'checkout_attempt_id')) THEN
    RAISE EXCEPTION 'checkout_legacy_payment_in_progress';
  END IF;
  IF proposed.meta->>'checkout_discount_intent_id' IS NOT NULL AND
    purchase.meta->>'checkout_discount_intent_id' IS DISTINCT FROM proposed.meta->>'checkout_discount_intent_id' THEN
    IF coalesce((proposed.meta->>'referral_customer_credit_applied_minor')::numeric,0)>0
      OR coalesce((proposed.meta->>'referral_partner_bonus_applied_minor')::numeric,0)>0 THEN
      RAISE EXCEPTION 'legacy_discount_purchase_requires_reconciliation';
    END IF;
    UPDATE public.orders_v2 SET meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('checkout_discount_intent_id',proposed.meta->'checkout_discount_intent_id')
      WHERE id=purchase.id RETURNING * INTO purchase;
  END IF;
  -- A different provider may create a new attempt, but cannot race a request
  -- whose upstream outcome is unknown (nor duplicate a subscription mandate).
  SELECT * INTO attempt FROM public.crm_checkout_attempts
    WHERE order_id=purchase.id AND (state IN ('creating','unknown') OR (state='ready' AND attempt_kind='charge'))
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF attempt.state='ready' AND attempt.attempt_kind=p_attempt_kind AND attempt.provider=p_provider AND attempt.account_code=coalesce(p_account_code,'') THEN
      RETURN jsonb_build_object('state','ready','order',to_jsonb(purchase),'attempt_id',attempt.id,'result',attempt.result);
    END IF;
    RETURN jsonb_build_object('state','in_progress','order',to_jsonb(purchase),'attempt_id',attempt.id);
  END IF;
  SELECT * INTO attempt FROM public.crm_checkout_attempts
    WHERE order_id=purchase.id AND provider=p_provider AND account_code=COALESCE(p_account_code,'')
      AND attempt_kind=p_attempt_kind AND state='ready' AND expires_at>now()
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','payment_checkout.reused','orders_v2',purchase.id,
        jsonb_build_object('order_id',purchase.id,'attempt_id',attempt.id,'provider',p_provider));
    RETURN jsonb_build_object('state','ready','order',to_jsonb(purchase),'attempt_id',attempt.id,'result',attempt.result);
  END IF;
  INSERT INTO public.crm_checkout_attempts(order_id,provider,account_code,attempt_kind)
    VALUES(purchase.id,p_provider,COALESCE(p_account_code,''),p_attempt_kind) RETURNING * INTO attempt;
  RETURN jsonb_build_object('state','claimed','order',to_jsonb(purchase),'attempt_id',attempt.id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_claim_pending_purchase(jsonb,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_pending_purchase(jsonb,jsonb,text,text,text) TO service_role;
