-- Reserve BEFORE any provider POST. A lost response never permits an automatic retry.
CREATE TABLE IF NOT EXISTS public.payment_refund_requests (
  request_key uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.payments_v2(id),
  order_id uuid NOT NULL REFERENCES public.orders_v2(id),
  amount numeric NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  currency text NOT NULL,
  actor_user_id uuid NOT NULL,
  access_action text NOT NULL CHECK (access_action IN ('keep','keep_subscription','reduce','revoke')),
  reduce_days integer,
  order_group_item_id uuid,
  reason text NOT NULL,
  provider text NOT NULL,
  provider_refund_id text,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','unknown','provider_succeeded','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_refund_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_refund_requests TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS payment_refund_one_unresolved_request
  ON public.payment_refund_requests(payment_id)
  WHERE state IN ('reserved','unknown','provider_succeeded');

CREATE OR REPLACE FUNCTION public.reserve_payment_refund_request(
  _request_key uuid, _order_id uuid, _payment_id uuid, _amount numeric,
  _currency text, _actor_user_id uuid, _access_action text, _reduce_days integer,
  _order_group_item_id uuid, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE p public.payments_v2%ROWTYPE; existing public.payment_refund_requests%ROWTYPE;
BEGIN
  IF NOT coalesce((public.has_role_v2(_actor_user_id,'admin') OR public.has_role_v2(_actor_user_id,'super_admin')),false) THEN
    RAISE EXCEPTION 'refund_admin_required' USING ERRCODE='42501';
  END IF;
  IF _request_key IS NULL OR _amount IS NULL OR _amount <= 0 OR _amount <> round(_amount,2)
     OR _amount::text IN ('NaN','Infinity','-Infinity') OR nullif(trim(_reason),'') IS NULL
     OR _access_action IS NULL OR _access_action NOT IN ('keep','keep_subscription','reduce','revoke')
     OR (_access_action='reduce' AND coalesce(_reduce_days,0) <= 0) THEN
    RAISE EXCEPTION 'invalid_refund_request';
  END IF;
  -- Same lock order as canonical record_refund_atomic: payment, then order.
  SELECT * INTO p FROM public.payments_v2 WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND OR p.order_id IS DISTINCT FROM _order_id OR coalesce(p.is_deleted,false)
     OR p.amount <= 0 OR p.status::text <> 'succeeded'
     OR coalesce(p.transaction_type,'') ~* 'refund|возврат'
     OR nullif(p.provider_payment_id,'') IS NULL
     OR p.provider IS NULL OR p.provider NOT IN ('bepaid','stripe') OR p.currency IS DISTINCT FROM _currency THEN
    RAISE EXCEPTION 'selected_payment_not_refundable';
  END IF;
  SELECT * INTO existing FROM public.payment_refund_requests WHERE request_key=_request_key;
  IF FOUND THEN
    IF existing.order_id IS DISTINCT FROM _order_id OR existing.payment_id IS DISTINCT FROM _payment_id
      OR existing.amount IS DISTINCT FROM _amount OR existing.currency IS DISTINCT FROM _currency
      OR existing.access_action IS DISTINCT FROM _access_action OR existing.reduce_days IS DISTINCT FROM _reduce_days
      OR existing.order_group_item_id IS DISTINCT FROM _order_group_item_id OR existing.reason IS DISTINCT FROM _reason THEN
      RAISE EXCEPTION 'refund_request_key_conflict';
    END IF;
    RETURN jsonb_build_object('reserved',false,'state',existing.state,'provider_refund_id',existing.provider_refund_id);
  END IF;
  -- A confirmed canonical webhook/recording can release a completed financial reservation.
  UPDATE public.payment_refund_requests r SET state='completed', updated_at=now()
  WHERE r.payment_id=_payment_id AND r.state='provider_succeeded'
    AND EXISTS (SELECT 1 FROM public.payments_v2 f
      WHERE f.provider=r.provider AND f.provider_payment_id=r.provider_refund_id
        AND f.amount=-r.amount AND f.status::text='refunded'
        AND (f.reference_payment_id=r.payment_id OR f.meta->>'parent_payment_id'=r.payment_id::text));
  IF EXISTS (SELECT 1 FROM public.payment_refund_requests WHERE payment_id=_payment_id
       AND state IN ('reserved','unknown','provider_succeeded')) THEN
    RAISE EXCEPTION 'payment_refund_requires_review';
  END IF;
  IF _amount > p.amount-coalesce(p.refunded_amount,0) THEN
    RAISE EXCEPTION 'refund_exceeds_payment_balance';
  END IF;
  INSERT INTO public.payment_refund_requests(request_key,order_id,payment_id,amount,currency,
    actor_user_id,access_action,reduce_days,order_group_item_id,reason,provider)
  VALUES (_request_key,_order_id,_payment_id,_amount,_currency,_actor_user_id,_access_action,
    _reduce_days,_order_group_item_id,_reason,p.provider);
  RETURN jsonb_build_object('reserved',true,'state','reserved');
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_payment_refund_request(uuid,uuid,uuid,numeric,text,uuid,text,integer,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payment_refund_request(uuid,uuid,uuid,numeric,text,uuid,text,integer,uuid,text) TO service_role;

-- Keep the canonical writer and signature; fix exact-parent checks and repeated partial totals.
CREATE OR REPLACE FUNCTION public.record_refund_atomic(
 p_order_id uuid,p_parent_payment_id uuid,p_refund_amount numeric,p_refund_uid text,
 p_refund_reason text,p_actor_user_id uuid,p_target_user_id uuid,p_bepaid_response jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_parent public.payments_v2%ROWTYPE; v_order public.orders_v2%ROWTYPE;
 v_existing public.payments_v2%ROWTYPE; v_new_refund_id uuid;
 v_paid_sum numeric; v_prior_refunded numeric; v_parent_refunded numeric;
 v_total numeric; v_full boolean; v_status text; v_order_status text;
BEGIN
 IF p_refund_amount IS NULL OR p_refund_amount<=0 OR p_refund_amount<>round(p_refund_amount,2)
   OR p_refund_amount::text IN ('NaN','Infinity','-Infinity') OR nullif(trim(p_refund_uid),'') IS NULL THEN
   RAISE EXCEPTION 'invalid_refund_amount_or_uid';
 END IF;
 SELECT * INTO v_parent FROM public.payments_v2 WHERE id=p_parent_payment_id FOR UPDATE;
 IF NOT FOUND OR v_parent.order_id IS DISTINCT FROM p_order_id OR v_parent.provider IS DISTINCT FROM 'bepaid'
   OR v_parent.amount<=0 OR coalesce(v_parent.transaction_type,'') ~* 'refund|возврат' THEN
   RAISE EXCEPTION 'refund_parent_mismatch';
 END IF;
 SELECT * INTO v_order FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_parent.currency IS DISTINCT FROM v_order.currency THEN RAISE EXCEPTION 'refund_order_mismatch'; END IF;
 -- Recheck the UID after locking; two concurrent recordings cannot both insert it.
 SELECT * INTO v_existing FROM public.payments_v2 WHERE provider='bepaid' AND provider_payment_id=p_refund_uid LIMIT 1;
 IF FOUND THEN
   IF v_existing.order_id IS DISTINCT FROM p_order_id OR abs(v_existing.amount)<>p_refund_amount
      OR NOT (v_existing.reference_payment_id IS NOT DISTINCT FROM p_parent_payment_id
        OR coalesce(v_existing.meta->>'parent_payment_id','')=p_parent_payment_id::text) THEN
     RAISE EXCEPTION 'refund_uid_parent_mismatch';
   END IF;
   RETURN jsonb_build_object('success',true,'idempotent',true,'refund_payment_id',v_existing.id);
 END IF;
 IF coalesce(v_parent.is_deleted,false) OR v_parent.status::text NOT IN ('succeeded','paid','partially_refunded') THEN
   RAISE EXCEPTION 'parent_payment_not_refundable';
 END IF;
 -- Per-parent maximum covers both canonical counter+row and legacy row-only refunds.
 WITH refunds AS (
   SELECT f.*, coalesce(f.reference_payment_id::text,f.meta->>'parent_payment_id') parent_id
   FROM public.payments_v2 f WHERE f.order_id=p_order_id AND NOT coalesce(f.is_deleted,false)
     AND f.status::text IN ('refunded','succeeded','paid')
     AND (f.amount<0 OR coalesce(f.transaction_type,'') ~* 'refund|возврат' OR f.meta->>'type'='refund')
 ), parents AS (
   SELECT p.id,p.amount,greatest(coalesce(p.refunded_amount,0),
      coalesce((SELECT sum(abs(f.amount)) FROM refunds f WHERE f.parent_id=p.id::text),0)) refunded
   FROM public.payments_v2 p WHERE p.order_id=p_order_id AND NOT coalesce(p.is_deleted,false)
     AND p.amount>0 AND p.status::text IN ('succeeded','paid','refunded','partially_refunded')
     AND coalesce(p.transaction_type,'') !~* 'refund|возврат' AND coalesce(p.meta->>'type','')<>'refund'
 ) SELECT coalesce(sum(amount),0),coalesce(sum(refunded),0)+
     coalesce((SELECT sum(abs(f.amount)) FROM refunds f WHERE NOT EXISTS(SELECT 1 FROM parents p WHERE p.id::text=f.parent_id)),0),
     coalesce(max(refunded) FILTER (WHERE id=p_parent_payment_id),0)
 INTO v_paid_sum,v_prior_refunded,v_parent_refunded FROM parents;
 IF p_refund_amount>v_parent.amount-v_parent_refunded THEN RAISE EXCEPTION 'refund_exceeds_payment_balance'; END IF;
 v_total:=v_prior_refunded+p_refund_amount;
 v_full:=v_paid_sum>0 AND v_total>=v_paid_sum;
 v_status:=CASE WHEN v_full THEN 'full' ELSE 'partial' END;
 v_order_status:=CASE WHEN v_full THEN 'refunded' ELSE 'paid' END;
 INSERT INTO public.payments_v2(order_id,profile_id,user_id,amount,currency,status,transaction_type,provider,provider_payment_id,
   reference_payment_id,paid_at,meta)
 VALUES(p_order_id,v_order.profile_id,v_order.user_id,-p_refund_amount,v_order.currency,'refunded','refund','bepaid',p_refund_uid,
   p_parent_payment_id,now(),jsonb_build_object('type','refund','parent_payment_id',p_parent_payment_id,
   'parent_payment_uid',v_parent.provider_payment_id,'reason',p_refund_reason,'refund_status',v_status,'bepaid_response',p_bepaid_response))
 RETURNING id INTO v_new_refund_id;
 UPDATE public.payments_v2 SET refunded_amount=v_parent_refunded+p_refund_amount,updated_at=now() WHERE id=p_parent_payment_id;
 UPDATE public.orders_v2 SET status=v_order_status::order_status,updated_at=now(),meta=coalesce(meta,'{}')||jsonb_build_object(
   'refund_amount',p_refund_amount,'refund_reason',p_refund_reason,'refunded_at',now(),'refunded_by',p_actor_user_id,
   'bepaid_refund',p_bepaid_response,'partial_refund_total',v_total,'paid_sum',v_paid_sum,'refund_status',v_status)
 WHERE id=p_order_id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,actor_type,actor_label,action,meta)
 VALUES(p_actor_user_id,v_order.user_id,'user','subscription-admin-actions[refund]','admin.subscription.refund_recorded',
   jsonb_build_object('order_id',p_order_id,'order_number',v_order.order_number,'refund_amount',p_refund_amount,
     'refund_status',v_status,'paid_sum',v_paid_sum,'total_refunded_after',v_total,'parent_payment_id',p_parent_payment_id,
     'refund_uid',p_refund_uid,'new_order_status',v_order_status));
 RETURN jsonb_build_object('success',true,'idempotent',false,'refund_payment_id',v_new_refund_id,
   'refund_status',v_status,'new_order_status',v_order_status,'paid_sum',v_paid_sum,'total_refunded_after',v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.record_refund_atomic(uuid,uuid,numeric,text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund_atomic(uuid,uuid,numeric,text,text,uuid,uuid,jsonb) TO service_role;
