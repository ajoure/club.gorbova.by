-- Reserve a discount once per unfinished purchase, before checkout pricing.
-- Browser idempotency keys and payment providers are not purchase identity.
CREATE TABLE public.crm_checkout_discount_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_key text NOT NULL,contract jsonb NOT NULL,
  order_id uuid REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  result jsonb,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE INDEX crm_checkout_discount_intents_identity ON public.crm_checkout_discount_intents(identity_key,created_at DESC);
ALTER TABLE public.crm_checkout_discount_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_checkout_discount_intents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.crm_checkout_discount_intents TO service_role;

CREATE OR REPLACE FUNCTION public.crm_reserve_checkout_discounts(p_order jsonb,p_context jsonb,p_credit bigint,p_bonus bigint,p_cycles integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE contract jsonb; k text; i public.crm_checkout_discount_intents%ROWTYPE; credit jsonb; bonus jsonb;
  amount bigint; requested bigint; credit_total bigint; credit_per_charge bigint; bonus_minor bigint; expiry timestamptz;
BEGIN
  amount:=round((p_order->>'final_price')::numeric*100);
  IF amount<=100 OR p_cycles<1 OR p_cycles>120 OR p_credit<0 OR p_bonus<0 OR p_context IS NULL THEN RAISE EXCEPTION 'invalid_checkout_discount_request'; END IF;
  contract:=jsonb_build_object('user_id',p_order->'user_id','product_id',p_order->'product_id','tariff_id',p_order->'tariff_id',
    'currency',upper(p_order->>'currency'),'amount',amount,'context',p_context,'credit',p_credit,'bonus',p_bonus,'cycles',p_cycles,
    'access_days',(SELECT access_days FROM public.tariffs WHERE id=(p_order->>'tariff_id')::uuid));
  k:=md5(contract::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('crm_checkout_discount:'||k,0));
  SELECT d.* INTO i FROM public.crm_checkout_discount_intents d LEFT JOIN public.orders_v2 o ON o.id=d.order_id
    WHERE d.identity_key=k AND ((d.order_id IS NULL AND d.expires_at>now()) OR
      (o.status IN('pending','failed') AND NOT coalesce(o.is_deleted,false) AND coalesce(o.paid_amount,0)=0))
    ORDER BY d.created_at DESC LIMIT 1 FOR UPDATE OF d;
  IF i.id IS NOT NULL AND i.result IS NOT NULL THEN
    -- A reservation released by a deliberate cancellation must not silently
    -- fund a new checkout. Preserve the evidence for explicit reconciliation.
    IF EXISTS(SELECT 1 FROM public.referral_customer_credit_entries WHERE id=nullif(i.result->>'credit_reservation_id','')::uuid AND status<>'reserved')
      OR EXISTS(SELECT 1 FROM public.referral_bonus_reservations WHERE id=nullif(i.result->>'bonus_reservation_id','')::uuid AND status<>'reserved')
      THEN RAISE EXCEPTION 'checkout_discount_reservation_requires_reconciliation'; END IF;
    UPDATE public.referral_customer_credit_entries SET expires_at=now()+interval '24 hours'
      WHERE id=nullif(i.result->>'credit_reservation_id','')::uuid AND status='reserved';
    UPDATE public.referral_bonus_reservations SET expires_at=now()+interval '24 hours'
      WHERE id=nullif(i.result->>'bonus_reservation_id','')::uuid AND status='reserved';
    RETURN i.result;
  END IF;
  IF i.id IS NULL THEN
    INSERT INTO public.crm_checkout_discount_intents(identity_key,contract) VALUES(k,contract) RETURNING * INTO i;
  END IF;
  requested:=least((p_credit/p_cycles)*p_cycles,greatest(0,(amount-100)*p_cycles));
  credit:=public.referral_reserve_customer_credit((p_order->>'user_id')::uuid,requested,amount*p_cycles,'crm:credit:'||i.id);
  credit_total:=coalesce((credit->>'applied_minor')::bigint,0);credit_per_charge:=credit_total/p_cycles;
  bonus:=public.referral_reserve_partner_bonus((p_order->>'user_id')::uuid,p_bonus,amount-credit_per_charge,'crm:bonus:'||i.id,(p_order->>'product_id')::uuid);
  bonus_minor:=coalesce((bonus->>'applied_minor')::bigint,0);
  expiry:=now()+interval '24 hours';
  UPDATE public.referral_customer_credit_entries SET expires_at=expiry WHERE id=nullif(credit->>'reservation_id','')::uuid AND status='reserved';
  UPDATE public.referral_bonus_reservations SET expires_at=expiry WHERE id=nullif(bonus->>'reservation_id','')::uuid AND status='reserved';
  UPDATE public.crm_checkout_discount_intents SET result=jsonb_build_object('intent_id',i.id,'credit_minor',credit_total,
    'credit_per_charge_minor',credit_per_charge,'credit_reservation_id',credit->'reservation_id',
    'bonus_minor',bonus_minor,'bonus_reservation_id',bonus->'reservation_id') WHERE id=i.id RETURNING * INTO i;
  RETURN i.result;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_reserve_checkout_discounts(jsonb,jsonb,bigint,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reserve_checkout_discounts(jsonb,jsonb,bigint,bigint,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_bind_checkout_discount_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE intent uuid; i public.crm_checkout_discount_intents%ROWTYPE;
BEGIN
  BEGIN intent:=nullif(NEW.meta->>'checkout_discount_intent_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_discount_intent_id'; END;
  IF intent IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO i FROM public.crm_checkout_discount_intents WHERE id=intent FOR UPDATE;
  IF NOT FOUND OR i.contract->>'user_id' IS DISTINCT FROM NEW.user_id::text
    OR i.contract->>'product_id' IS DISTINCT FROM NEW.product_id::text
    OR i.contract->>'tariff_id' IS DISTINCT FROM NEW.tariff_id::text
    OR (i.order_id IS NOT NULL AND i.order_id<>NEW.id)
    THEN RAISE EXCEPTION 'discount_intent_purchase_mismatch'; END IF;
  UPDATE public.crm_checkout_discount_intents SET order_id=NEW.id WHERE id=intent;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_bind_checkout_discount_intent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_bind_checkout_discount_intent AFTER INSERT OR UPDATE OF meta ON public.orders_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_bind_checkout_discount_intent();

-- Failed checkout attempts do not cancel the purchase or its reserved discount.
create or replace function public.referral_customer_credit_order_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reservation_id uuid;
begin
  IF NEW.checkout_purchase_key IS NOT NULL AND NEW.status::text='failed' THEN RETURN NEW; END IF;
  begin v_reservation_id := nullif(new.meta->>'referral_customer_credit_reservation_id','')::uuid;
  exception when invalid_text_representation then v_reservation_id := null; end;
  if v_reservation_id is null then return new; end if;
  if new.status::text = 'paid' then
    update public.referral_customer_credit_entries
      set status = 'consumed', applied_order_id = new.id, expires_at = null
      where id = v_reservation_id and status in ('reserved','consumed');
  elsif new.status::text in ('failed','cancelled','canceled','refunded') then
    update public.referral_customer_credit_entries
      set status = 'released', applied_order_id = new.id, expires_at = null
      where id = v_reservation_id and status = 'reserved';
  else
    update public.referral_customer_credit_entries
      set applied_order_id = new.id
      where id = v_reservation_id and status = 'reserved' and applied_order_id is null;
  end if;
  return new;
end $$;

-- Failed checkout attempts do not cancel the purchase or its reserved discount.
create or replace function public.referral_apply_bonus_reservation_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res public.referral_bonus_reservations%rowtype; v_tx uuid; v_key text;
begin
  IF NEW.checkout_purchase_key IS NOT NULL AND NEW.status::text='failed' THEN RETURN NEW; END IF;
  v_key := nullif(new.meta->>'referral_partner_bonus_reservation_id', '');
  if v_key is null or new.status::text not in ('paid', 'failed', 'cancelled', 'refunded') then return new; end if;
  select * into v_res from public.referral_bonus_reservations where id = v_key::uuid for update;
  if v_res.id is null or v_res.status <> 'reserved' then return new; end if;
  if new.status::text = 'paid' then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_res.partner_id, 'bonus_spend', 'referral:bonus:spend:' || v_res.id, 'order', new.id, 'Использован внутренний бонус') returning id into v_tx;
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx, v_res.partner_id, 'internal_held', -v_res.amount_minor), (v_tx, v_res.partner_id, 'internal_spent', v_res.amount_minor);
    update public.referral_bonus_reservations set status = 'consumed', applied_order_id = new.id, updated_at = now() where id = v_res.id;
  else
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_res.partner_id, 'bonus_release', 'referral:bonus:release:' || v_res.id, 'order', new.id, 'Возврат внутреннего бонуса') returning id into v_tx;
    insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx, v_res.partner_id, 'internal_held', -v_res.amount_minor), (v_tx, v_res.partner_id, 'internal', v_res.amount_minor);
    update public.referral_bonus_reservations set status = 'released', applied_order_id = new.id, updated_at = now() where id = v_res.id;
  end if;
  return new;
exception when invalid_text_representation then return new;
end $$;
