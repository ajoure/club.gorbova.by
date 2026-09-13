-- A purchase owns multiple checkout attempts; expiring an attempt never inserts
-- another CRM purchase. No historical rows are changed by this migration.
ALTER TABLE public.orders_v2 ADD COLUMN IF NOT EXISTS checkout_purchase_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_v2_open_checkout_purchase_key
  ON public.orders_v2(checkout_purchase_key)
  WHERE checkout_purchase_key IS NOT NULL AND NOT is_deleted
    AND status IN ('pending', 'failed') AND COALESCE(paid_amount,0) = 0;

CREATE TABLE IF NOT EXISTS public.crm_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('bepaid','stripe','rr','bank')),
  account_code text NOT NULL DEFAULT '',
  attempt_kind text NOT NULL DEFAULT 'checkout' CHECK(attempt_kind IN ('checkout','charge')),
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','ready','failed','unknown')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_checkout_attempts_order_idx ON public.crm_checkout_attempts(order_id, created_at DESC);
ALTER TABLE public.crm_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_checkout_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_checkout_attempts TO service_role;

-- Same normalized contract as pendingPurchaseContext; used to adopt an
-- unkeyed legacy purchase without guessing by product/tariff alone.
CREATE OR REPLACE FUNCTION public.crm_checkout_context_from_order(o jsonb,kind text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
SELECT jsonb_build_object('kind',kind,'offer_id',o->'offer_id',
  'payer_type',CASE WHEN o->>'payer_type'='individual' THEN NULL ELSE o->>'payer_type' END,
  'company_id',o->'company_id','legal_details_id',o#>'{meta,legal_details_id}',
  'month',o#>'{meta,deal_month}','access_days',o#>'{purchase_snapshot,access_days}',
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
  PERFORM pg_advisory_xact_lock(hashtextextended('crm_purchase:' || identity_key,0));
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

CREATE OR REPLACE FUNCTION public.crm_finish_checkout_attempt(p_attempt_id uuid,p_state text,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE a public.crm_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.crm_checkout_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_attempt_missing'; END IF;
  IF p_state NOT IN ('ready','failed','unknown') OR (p_state='ready' AND
    (p_result->>'success' IS DISTINCT FROM 'true' OR
      NOT (COALESCE(p_result->>'redirect_url','') LIKE 'https://%'
        OR ((a.provider='bank' OR a.attempt_kind='charge') AND p_result->>'order_id'=a.order_id::text)))) THEN
    RAISE EXCEPTION 'invalid_checkout_attempt_result';
  END IF;
  IF a.state <> 'creating' THEN RETURN a.state=p_state AND a.result IS NOT DISTINCT FROM p_result; END IF;
  UPDATE public.crm_checkout_attempts SET state=p_state,result=p_result,updated_at=now() WHERE id=a.id;
  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','payment_checkout.' || p_state,'orders_v2',a.order_id,
      jsonb_build_object('order_id',a.order_id,'attempt_id',a.id,'provider',a.provider));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_finish_checkout_attempt(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finish_checkout_attempt(uuid,text,jsonb) TO service_role;

-- Persist the invoice and its money atomically. Initial payment consumes the
-- exact linked pending purchase; renewal invoices create distinct purchases.
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
    SELECT * INTO purchase FROM public.orders_v2 WHERE id=p_pending_order_id FOR UPDATE;
    IF NOT FOUND OR purchase.user_id IS DISTINCT FROM proposed.user_id
      OR purchase.product_id IS DISTINCT FROM proposed.product_id
      OR purchase.tariff_id IS DISTINCT FROM proposed.tariff_id
      OR upper(purchase.currency) IS DISTINCT FROM upper(proposed.currency) THEN
      RAISE EXCEPTION 'stripe_pending_purchase_mismatch';
    END IF;
    UPDATE public.orders_v2 SET status='paid',paid_amount=COALESCE(paid_amount,0)+proposed.paid_amount,
      provider='stripe',provider_payment_id=proposed.provider_payment_id,is_deleted=false,
      meta=COALESCE(meta,'{}'::jsonb)||(proposed.meta-'crm_routing_snapshot')
        ||CASE WHEN meta ? 'crm_routing_snapshot' THEN '{}'::jsonb ELSE jsonb_build_object('crm_routing_snapshot',proposed.meta->'crm_routing_snapshot') END,
      pipeline_id=pipeline_id
      WHERE id=purchase.id RETURNING * INTO purchase;
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

-- A read before provider conflict checks returns the already-created checkout
-- without creating a purchase or another recurring mandate.
CREATE OR REPLACE FUNCTION public.crm_lookup_pending_checkout(
  p_order jsonb,p_context jsonb,p_provider text,p_account_code text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('state',CASE WHEN a.attempt_kind='charge' THEN 'in_progress' ELSE a.state END,'result',a.result)
  FROM public.orders_v2 o JOIN public.crm_checkout_attempts a ON a.order_id=o.id
  WHERE o.checkout_purchase_key=md5(jsonb_build_object('version',1,
    'recipient',(p_order->>'user_id')::uuid,'product',(p_order->>'product_id')::uuid,
    'tariff',(p_order->>'tariff_id')::uuid,'currency',upper(p_order->>'currency'),
    'amount',(p_order->>'final_price')::numeric,'context',p_context)::text)
    AND NOT o.is_deleted AND o.status IN ('pending','failed') AND COALESCE(o.paid_amount,0)=0
    AND (a.state IN ('creating','unknown') OR (a.state='ready' AND a.attempt_kind='charge') OR (a.state='ready' AND a.attempt_kind='checkout' AND a.provider=p_provider
      AND a.account_code=COALESCE(p_account_code,'') AND a.expires_at>now()))
  ORDER BY CASE WHEN a.state IN ('creating','unknown') OR a.attempt_kind='charge' THEN 0 ELSE 1 END,a.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.crm_lookup_pending_checkout(jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lookup_pending_checkout(jsonb,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_refresh_paid_purchase(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE purchase public.orders_v2%ROWTYPE; gross numeric;
BEGIN
  SELECT * INTO purchase FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase_missing'; END IF;
  SELECT sum(amount) INTO gross FROM public.payments_v2
    WHERE order_id=p_order_id AND NOT COALESCE(is_deleted,false)
      AND upper(currency)=upper(purchase.currency) AND amount>0
      AND status IN ('succeeded','refunded','partially_refunded')
      AND COALESCE(transaction_type,'payment') IN ('payment','sale','capture','Платеж');
  IF COALESCE(gross,0)<=0 THEN RAISE EXCEPTION 'purchase_without_money'; END IF;
  UPDATE public.orders_v2 SET paid_amount=greatest(COALESCE(paid_amount,0),gross),
    status=CASE WHEN purchase.status='refunded' THEN 'refunded'::public.order_status
      WHEN gross>=final_price THEN 'paid'::public.order_status ELSE 'partial'::public.order_status END,
    is_deleted=false WHERE id=p_order_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_refresh_paid_purchase(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_refresh_paid_purchase(uuid) TO service_role;

-- RR retains its existing provider reconciliation state machine. Session age
-- no longer creates another purchase; known-not-created retries keep the ID.
CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb,
  _crm_routing_snapshot jsonb DEFAULT NULL,
  _pipeline_id uuid DEFAULT NULL,
  _pipeline_stage_id uuid DEFAULT NULL,
  _checkout_fingerprint text DEFAULT ''
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
  v_fingerprint text := COALESCE(_checkout_fingerprint, '');
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'')||'|'||coalesce(_user_id::text,'')||'|'||
    coalesce(_email_norm,'')||'|'||coalesce(_phone_norm,'')||'|'||v_fingerprint, 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND coalesce(o.meta->>'checkout_fingerprint', '') = v_fingerprint
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (_email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm)
     AND (_phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm)
     AND NOT coalesce(o.is_deleted,false) AND coalesce(o.paid_amount,0)=0
     AND o.product_id=_product_id AND o.tariff_id=_tariff_id
     AND o.final_price=_amount AND upper(o.currency)=upper(_currency)
     AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id
       AND p.amount>0 AND p.status IN ('succeeded','refunded','partially_refunded'))
     AND (o.status='pending'::order_status OR
       (o.status='failed'::order_status AND o.meta#>>'{rr,upstream_outcome}'='not_created'))

   ORDER BY
     CASE
       WHEN (o.meta->'rr'->>'upstream_call_state') = 'started'
            AND coalesce(o.meta->'rr'->>'initiation_status','pending') NOT IN ('created','failed') THEN 0
       WHEN (o.meta->'rr'->>'local_persist_failed') = 'true' THEN 1
       WHEN (o.meta->'rr'->>'upstream_outcome') = 'unknown' THEN 2
       WHEN (o.meta->'rr'->>'reconciliation_status') = 'resolved' THEN 3
       WHEN (o.meta->'rr'->>'initiation_status') = 'created' THEN 4
       ELSE 5
     END, o.created_at DESC LIMIT 1;

  IF FOUND THEN
    -- Re-enter only when no provider request was made or the provider
    -- positively confirmed no creation. Unknown/recovery/operator guards
    -- remain durable and are handled by the existing caller.
    IF (v_row.meta#>>'{rr,upstream_outcome}'='not_created') OR
      (v_row.meta#>>'{rr,upstream_call_state}'='not_started'
       AND v_row.created_at < now()-interval '120 seconds'
       AND coalesce(v_row.meta#>>'{rr,initiation_status}','pending')='pending'
       AND coalesce(v_row.meta#>>'{rr,upstream_outcome}','')<>'unknown'
       AND coalesce(v_row.meta#>>'{rr,local_persist_failed}','false')<>'true') THEN
      INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
        VALUES('system','payment_checkout.rr_attempt_restarted','orders_v2',v_row.id,
          jsonb_build_object('order_id',v_row.id,'previous_state',jsonb_build_object('upstream_outcome',v_row.meta#>>'{rr,upstream_outcome}','initiation_status',v_row.meta#>>'{rr,initiation_status}')));
      UPDATE public.orders_v2 SET status='pending',
        meta=jsonb_set(coalesce(meta,'{}'::jsonb),'{rr}',
          coalesce(_meta->'rr','{}'::jsonb)||jsonb_build_object('upstream_call_state','not_started'),true)
        WHERE id=v_row.id;
      order_id:=v_row.id; was_reused:=false; order_number:=v_row.order_number;
      RETURN NEXT; RETURN;
    END IF;
    order_id := v_row.id; was_reused := true; order_number := v_row.order_number;
    RETURN NEXT; RETURN;
  END IF;

  v_meta := jsonb_set(
    v_meta, '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object('upstream_call_state','not_started'),
    true
  );
  v_meta := jsonb_set(v_meta, '{checkout_fingerprint}', to_jsonb(v_fingerprint), true);
  IF _crm_routing_snapshot IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{crm_routing_snapshot}', _crm_routing_snapshot, true);
  END IF;

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, provider,
    customer_email, customer_phone, customer_ip, user_id, meta,
    pipeline_id, pipeline_stage_id)
  VALUES (v_order_number, _product_id, _tariff_id, _offer_id, _amount, _amount, _currency,
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip, _user_id, v_meta,
    _pipeline_id, _pipeline_stage_id)
  RETURNING * INTO v_row;
  order_id := v_row.id; was_reused := false; order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) TO service_role;


-- Merge only checkout-owned metadata under the order lock. A provider callback
-- may have already attached financial/access metadata while the HTTP request
-- was in flight; it must not be replaced by a stale pre-checkout JSON object.
CREATE OR REPLACE FUNCTION public.crm_merge_checkout_metadata(p_order_id uuid,p_patch jsonb,p_history_entry jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_meta jsonb; merged jsonb;
BEGIN
  IF jsonb_typeof(p_patch)<>'object' OR p_patch ?| ARRAY['checkout_purchase_identity','crm_routing_snapshot','financial_kind','source'] THEN
    RAISE EXCEPTION 'invalid_checkout_metadata_patch';
  END IF;
  SELECT coalesce(meta,'{}'::jsonb) INTO current_meta FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase_missing'; END IF;
  merged:=current_meta||p_patch;
  IF p_patch ? 'stripe' THEN merged:=jsonb_set(merged,'{stripe}',coalesce(current_meta->'stripe','{}'::jsonb)||(p_patch->'stripe')); END IF;
  IF p_history_entry IS NOT NULL THEN
    merged:=jsonb_set(merged,'{checkout_tokens_history}',
      CASE WHEN jsonb_typeof(current_meta->'checkout_tokens_history')='array' THEN current_meta->'checkout_tokens_history' ELSE '[]'::jsonb END
      || jsonb_build_array(p_history_entry));
  END IF;
  UPDATE public.orders_v2 SET meta=merged WHERE id=p_order_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_merge_checkout_metadata(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_merge_checkout_metadata(uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_finish_declined_charge_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE attempt_id uuid;
BEGIN
  IF NEW.status<>'failed' OR NEW.provider_payment_id IS NULL OR NEW.meta->>'checkout_attempt_id' IS NULL THEN RETURN NEW; END IF;
  BEGIN attempt_id:=(NEW.meta->>'checkout_attempt_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
  UPDATE public.crm_checkout_attempts SET state='failed',updated_at=now(),
    result=jsonb_build_object('success',false,'error','provider_charge_declined')
    WHERE id=attempt_id AND order_id=NEW.order_id AND attempt_kind='charge' AND state IN ('creating','ready','unknown');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_finish_declined_charge_attempt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_finish_declined_charge_attempt AFTER INSERT OR UPDATE OF status,provider_payment_id ON public.payments_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_finish_declined_charge_attempt();

-- Only an authenticated server-side provider GET may request this transition.
-- It synchronizes an already terminal checkout; it does not cancel a mandate.
CREATE OR REPLACE FUNCTION public.crm_sync_expired_pending_checkout(p_provider_row_id uuid,p_provider_subscription_id text,p_terminal_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE p public.provider_subscriptions%ROWTYPE; s public.subscriptions_v2%ROWTYPE; attempt_id uuid;
BEGIN
  IF p_terminal_state NOT IN ('expired','canceled') THEN RAISE EXCEPTION 'invalid_checkout_terminal_state'; END IF;
  SELECT * INTO p FROM public.provider_subscriptions WHERE id=p_provider_row_id FOR UPDATE;
  IF NOT FOUND OR p.provider_subscription_id IS DISTINCT FROM p_provider_subscription_id THEN RAISE EXCEPTION 'pending_provider_identity_changed'; END IF;
  IF p.state=p_terminal_state THEN RETURN true; END IF;
  IF p.state NOT IN ('pending','redirecting') THEN RAISE EXCEPTION 'pending_provider_state_changed'; END IF;
  SELECT * INTO s FROM public.subscriptions_v2 WHERE id=p.subscription_v2_id FOR UPDATE;
  IF NOT FOUND OR s.status NOT IN ('pending','past_due') THEN RAISE EXCEPTION 'pending_subscription_state_changed'; END IF;
  PERFORM id FROM public.orders_v2 WHERE id=coalesce(p.order_id,s.order_id) FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.orders_v2 WHERE id=coalesce(p.order_id,s.order_id) AND (status IN('paid','partial','refunded') OR coalesce(paid_amount,0)>0))
    OR EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id=coalesce(p.order_id,s.order_id) AND status IN('succeeded','refunded','partially_refunded') AND amount>0 AND NOT coalesce(is_deleted,false))
    THEN RAISE EXCEPTION 'pending_checkout_money_arrived'; END IF;
  UPDATE public.provider_subscriptions SET state=p_terminal_state,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('checkout_terminal_verified_at',now()) WHERE id=p.id;
  UPDATE public.subscriptions_v2 SET status='expired',auto_renew=false WHERE id=s.id;
  BEGIN attempt_id:=(p.meta->>'checkout_attempt_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN attempt_id:=NULL; END;
  UPDATE public.crm_checkout_attempts SET state='failed',updated_at=now(),result='{"success":false,"error":"provider_checkout_expired"}'
    WHERE id=attempt_id AND order_id=coalesce(p.order_id,s.order_id) AND provider=p.provider AND attempt_kind='checkout'
      AND state IN ('creating','unknown','ready');
  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','payment_checkout.provider_terminal_synced','provider_subscriptions',p.id,
      jsonb_build_object('provider_subscription_row_id',p.id,'terminal_state',p_terminal_state));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sync_expired_pending_checkout(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sync_expired_pending_checkout(uuid,text,text) TO service_role;
