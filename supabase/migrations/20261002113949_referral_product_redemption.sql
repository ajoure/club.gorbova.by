-- Referral redemptions: server-priced quote, atomic debit and independent access.
-- No payments, provider cancellation, customer notifications or negative wallets.
CREATE SCHEMA IF NOT EXISTS referral_private;
REVOKE ALL ON SCHEMA referral_private FROM PUBLIC, anon, authenticated;

INSERT INTO public.permissions(code,name,category) VALUES
 ('referral.redeem','Выдать продукты за реферальные бонусы','referrals'),
 ('referral.convert_cash','Конвертировать денежную часть с согласием клиента','referrals'),
 ('referral.subsidy','Покрыть разницу подарком компании','referrals'),
 ('referral.override_catalog','Изменить цену или разрешить продукт для бонусов','referrals'),
 ('referral.reverse_redemption','Отменить реферальную выдачу','referrals')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE r.code IN ('admin','super_admin') AND p.code IN
 ('referral.redeem','referral.convert_cash','referral.subsidy','referral.override_catalog','referral.reverse_redemption')
ON CONFLICT(role_id,permission_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS referral_private.quotes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
 partner_id uuid NOT NULL REFERENCES public.referral_partners(id),
 request jsonb NOT NULL, snapshot jsonb NOT NULL,
 anchor timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.referral_redemptions(
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES public.referral_partners(id),
 profile_id uuid NOT NULL REFERENCES public.profiles(id), user_id uuid NOT NULL,
 actor_id uuid NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) >= 5),
 consent_reference text, provider_acknowledged boolean NOT NULL DEFAULT false,
 total_minor bigint NOT NULL CHECK(total_minor > 0),
 internal_minor bigint NOT NULL CHECK(internal_minor >= 0),
 converted_cash_minor bigint NOT NULL CHECK(converted_cash_minor >= 0),
 subsidy_minor bigint NOT NULL CHECK(subsidy_minor >= 0),
 status text NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','reversed')),
 snapshot jsonb NOT NULL, reversed_at timestamptz, reversed_by uuid, reversal_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total_minor = internal_minor + converted_cash_minor + subsidy_minor)
);
CREATE TABLE IF NOT EXISTS public.referral_redemption_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), redemption_id uuid NOT NULL REFERENCES public.referral_redemptions(id),
 product_id uuid NOT NULL REFERENCES public.products_v2(id), tariff_id uuid NOT NULL REFERENCES public.tariffs(id),
 offer_id uuid NOT NULL REFERENCES public.tariff_offers(id), order_id uuid NOT NULL REFERENCES public.orders_v2(id),
 source_id uuid NOT NULL REFERENCES public.entitlement_sources(id),
 price_minor bigint NOT NULL CHECK(price_minor > 0),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at > starts_at),
 phase text NOT NULL CHECK(phase IN ('scheduled','active','expired','revoked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.referral_redemption_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES public.referral_redemption_items(id),
 event_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 leased_until timestamptz, error_code text, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_redemption_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_redemption_outbox ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.referral_redemptions,public.referral_redemption_items TO authenticated;
GRANT ALL ON public.referral_redemptions,public.referral_redemption_items,public.referral_redemption_outbox TO service_role;
CREATE POLICY referral_redemption_read ON public.referral_redemptions FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.has_admin_section_access(auth.uid(),'referrals','view') OR public.has_admin_section_access(auth.uid(),'contacts','view'));
CREATE POLICY referral_redemption_item_read ON public.referral_redemption_items FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.referral_redemptions r WHERE r.id=redemption_id));
-- Public presentation never exposes the staff reason or consent evidence to the customer.
REVOKE SELECT ON public.referral_redemptions FROM authenticated;
GRANT SELECT(id,partner_id,profile_id,user_id,total_minor,internal_minor,converted_cash_minor,subsidy_minor,status,created_at) ON public.referral_redemptions TO authenticated;

CREATE OR REPLACE FUNCTION referral_private.allowed(p_actor uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_actor IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.user_roles_v2 ur JOIN public.role_permissions rp ON rp.role_id=ur.role_id
 JOIN public.permissions p ON p.id=rp.permission_id WHERE ur.user_id=p_actor AND p.code=p_permission)
$$;
REVOKE ALL ON FUNCTION referral_private.allowed(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION referral_private.balance(p_partner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
 'internal',coalesce(sum(amount_minor) FILTER(WHERE bucket='internal'),0),
 'available',coalesce(sum(amount_minor) FILTER(WHERE bucket='available'),0),
 'pending',coalesce(sum(amount_minor) FILTER(WHERE bucket='pending'),0),
 'internal_pending',coalesce(sum(amount_minor) FILTER(WHERE bucket='internal_pending'),0),
 'held',coalesce(sum(amount_minor) FILTER(WHERE bucket='held'),0),
 'internal_held',coalesce(sum(amount_minor) FILTER(WHERE bucket='internal_held'),0))
 FROM public.referral_balance_entries WHERE partner_id=p_partner
$$;
REVOKE ALL ON FUNCTION referral_private.balance(uuid) FROM PUBLIC,anon,authenticated;

-- Rebuild the quote at commit using the same time anchor. Any catalog, balance,
-- rights, reservation or access change invalidates the confirmation.
CREATE OR REPLACE FUNCTION referral_private.build_quote(p_actor uuid,p_partner uuid,p_request jsonb,p_anchor timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_partner public.referral_partners%rowtype; v_user uuid; v_balance jsonb;
 v_item jsonb; v_product public.products_v2%rowtype; v_tariff public.tariffs%rowtype;
 v_offer public.tariff_offers%rowtype; v_items jsonb:='[]'; v_catalog jsonb:='[]';
 v_start timestamptz; v_end timestamptz; v_count integer; v_unit text; v_mode text;
 v_catalog_price bigint; v_price bigint; v_total bigint:=0; v_internal bigint; v_cash bigint; v_subsidy bigint;
 v_access jsonb; v_current_end timestamptz; v_perpetual boolean; v_provider boolean:=false; v_recurring boolean;
BEGIN
 IF NOT referral_private.allowed(p_actor,'referral.redeem') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_program_settings WHERE singleton AND is_enabled AND partner_bonus_enabled) THEN RAISE EXCEPTION 'program_disabled'; END IF;
 SELECT * INTO v_partner FROM public.referral_partners WHERE id=p_partner;
 IF v_partner.id IS NULL OR v_partner.status<>'active' THEN RAISE EXCEPTION 'partner_not_active'; END IF;
 SELECT user_id INTO v_user FROM public.profiles WHERE id=v_partner.profile_id;
 IF v_user IS NULL THEN RAISE EXCEPTION 'registered_account_required'; END IF;
 IF jsonb_typeof(p_request->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'items') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'items_required'; END IF;
 IF length(trim(coalesce(p_request->>'reason',''))) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
 IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(p_request->'items') x) <> jsonb_array_length(p_request->'items') THEN RAISE EXCEPTION 'duplicate_product'; END IF;
 v_balance:=referral_private.balance(p_partner);
 IF (v_balance->>'internal')::bigint < 0 OR (v_balance->>'available')::bigint < 0 THEN RAISE EXCEPTION 'wallet_requires_reconciliation'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'items') LOOP
  SELECT * INTO v_product FROM public.products_v2 WHERE id=(v_item->>'product_id')::uuid AND is_active;
  SELECT * INTO v_tariff FROM public.tariffs WHERE id=(v_item->>'tariff_id')::uuid AND product_id=v_product.id AND is_active;
  SELECT * INTO v_offer FROM public.tariff_offers WHERE id=(v_item->>'offer_id')::uuid AND tariff_id=v_tariff.id AND is_active;
  IF v_product.id IS NULL OR v_tariff.id IS NULL OR v_offer.id IS NULL THEN RAISE EXCEPTION 'catalog_item_unavailable'; END IF;
  IF (v_product.referral_bonus_eligible=false OR v_product.referral_settings_mode='disabled') AND NOT referral_private.allowed(p_actor,'referral.override_catalog') THEN RAISE EXCEPTION 'product_not_bonus_eligible'; END IF;
  v_unit:=coalesce(v_item->>'period_unit','months'); v_count:=(v_item->>'period_count')::integer;
  IF v_unit NOT IN ('months','days','dates') OR v_count IS NULL OR v_count NOT BETWEEN 1 AND 3660 THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF v_unit='months' AND v_count>120 THEN RAISE EXCEPTION 'invalid_period'; END IF;
  v_mode:=coalesce(v_item->>'start_mode','now');
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO v_access FROM (
   SELECT to_jsonb(es) x FROM public.entitlement_sources es WHERE user_id=v_user AND product_id=v_product.id
   UNION ALL SELECT to_jsonb(s) FROM public.subscriptions_v2 s WHERE user_id=v_user AND product_id=v_product.id
  ) a;
  SELECT max(expires_at),coalesce(bool_or(expires_at IS NULL),false) INTO v_current_end,v_perpetual FROM (
   SELECT expires_at FROM public.entitlement_sources WHERE user_id=v_user AND product_id=v_product.id AND status='active' AND (expires_at>p_anchor OR expires_at IS NULL)
   UNION ALL SELECT access_end_at FROM public.subscriptions_v2 WHERE user_id=v_user AND product_id=v_product.id AND status IN ('active','trial','past_due') AND (access_end_at>p_anchor OR access_end_at IS NULL)
  ) w;
  IF v_mode='after_current' THEN
   IF v_perpetual THEN RAISE EXCEPTION 'perpetual_access_select_explicit_start'; END IF;
   v_start:=greatest(p_anchor,coalesce(v_current_end,p_anchor));
  ELSIF v_mode='date' THEN
   v_start:=(v_item->>'starts_at')::timestamptz;
   IF v_start IS NULL OR v_start<p_anchor THEN RAISE EXCEPTION 'start_in_past'; END IF;
  ELSIF v_mode='now' THEN v_start:=p_anchor;
  ELSE RAISE EXCEPTION 'invalid_start_mode'; END IF;
  -- Calendar arithmetic in the product business timezone, independent of DB session timezone.
  v_end:=CASE v_unit WHEN 'months' THEN ((v_start AT TIME ZONE 'Europe/Minsk')+make_interval(months=>v_count)) AT TIME ZONE 'Europe/Minsk'
   WHEN 'days' THEN v_start+make_interval(days=>v_count) ELSE (v_item->>'expires_at')::timestamptz END;
  IF v_end IS NULL OR v_end<=v_start THEN RAISE EXCEPTION 'invalid_end_date'; END IF;
  v_recurring:=coalesce((v_offer.meta->'recurring'->>'is_recurring')::boolean,(v_offer.meta->>'is_recurring')::boolean,false);
  v_catalog_price:=round(v_offer.amount*100)::bigint;
  IF v_recurring THEN
   IF v_unit='months' AND coalesce(v_offer.meta->'recurring'->>'billing_period_mode','month') IN ('month','months') THEN v_catalog_price:=v_catalog_price*v_count;
   ELSE v_catalog_price:=NULL; END IF;
  END IF;
  v_price:=coalesce((v_item->>'price_minor')::bigint,v_catalog_price);
  IF v_price IS NULL OR v_price<=0 OR v_price>1000000000 THEN RAISE EXCEPTION 'invalid_price'; END IF;
  IF v_price IS DISTINCT FROM v_catalog_price AND NOT referral_private.allowed(p_actor,'referral.override_catalog') THEN RAISE EXCEPTION 'price_override_forbidden'; END IF;
  -- Do not destroy a legacy direct entitlement whose source is not represented in the aggregate.
  IF EXISTS(SELECT 1 FROM public.entitlements e WHERE e.user_id=v_user AND e.product_id=v_product.id AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at>p_anchor))
   AND NOT EXISTS(SELECT 1 FROM public.entitlement_sources es WHERE es.user_id=v_user AND es.product_id=v_product.id AND es.status='active')
   AND NOT EXISTS(SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id=v_user AND s.product_id=v_product.id AND s.status IN ('active','trial','past_due')) THEN RAISE EXCEPTION 'legacy_access_requires_reconciliation'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE user_id=v_user AND product_id=v_product.id AND
   (nullif(meta->>'bepaid_subscription_id','') IS NOT NULL OR nullif(meta->>'stripe_subscription_id','') IS NOT NULL OR coalesce(auto_renew,false))) INTO v_recurring;
  v_provider:=v_provider OR v_recurring;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'product_name',v_product.name,'tariff_id',v_tariff.id,'tariff_name',v_tariff.name,'offer_id',v_offer.id,'price_minor',v_price,'catalog_price_minor',v_catalog_price,'starts_at',v_start,'expires_at',v_end,'provider_warning',v_recurring,'period_unit',v_unit,'period_count',v_count));
  v_catalog:=v_catalog||jsonb_build_array(jsonb_build_object('product',to_jsonb(v_product),'tariff',to_jsonb(v_tariff),'offer',to_jsonb(v_offer),'access',v_access));
  v_total:=v_total+v_price;
 END LOOP;
 v_internal:=least(v_total,(v_balance->>'internal')::bigint);
 v_cash:=coalesce((p_request->>'cash_minor')::bigint,0);
 IF v_cash<0 OR v_cash>least(v_total-v_internal,(v_balance->>'available')::bigint) THEN RAISE EXCEPTION 'invalid_cash_conversion'; END IF;
 IF v_cash>0 AND (NOT referral_private.allowed(p_actor,'referral.convert_cash') OR length(trim(coalesce(p_request->>'consent_reference','')))<5) THEN RAISE EXCEPTION 'cash_consent_or_permission_required'; END IF;
 v_subsidy:=v_total-v_internal-v_cash;
 IF v_subsidy>0 AND (NOT coalesce((p_request->>'allow_subsidy')::boolean,false) OR NOT referral_private.allowed(p_actor,'referral.subsidy')) THEN RAISE EXCEPTION 'insufficient_bonus'; END IF;
 IF v_provider AND NOT coalesce((p_request->>'provider_acknowledged')::boolean,false) THEN RAISE EXCEPTION 'provider_subscription_acknowledgement_required'; END IF;
 RETURN jsonb_build_object('partner_id',p_partner,'profile_id',v_partner.profile_id,'user_id',v_user,'items',v_items,'total_minor',v_total,'internal_minor',v_internal,'converted_cash_minor',v_cash,'subsidy_minor',v_subsidy,'balances',v_balance,'catalog_version',md5(v_catalog::text),
 'reservations_version',md5(coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM public.referral_bonus_reservations r WHERE partner_id=p_partner AND status='reserved'),'[]')),
 'payout_version',md5(coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM public.referral_payout_requests r WHERE partner_id=p_partner AND status IN ('pending','approved')),'[]')),'provider_warning',v_provider);
END $$;
REVOKE ALL ON FUNCTION referral_private.build_quote(uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.referral_admin_quote_redemption(p_partner_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_snapshot jsonb; v_id uuid; v_anchor timestamptz:=now();
BEGIN
 v_snapshot:=referral_private.build_quote(auth.uid(),p_partner_id,p_request,v_anchor);
 INSERT INTO referral_private.quotes(actor_id,partner_id,request,snapshot,anchor,expires_at)
 VALUES(auth.uid(),p_partner_id,p_request,v_snapshot,v_anchor,v_anchor+interval '10 minutes') RETURNING id INTO v_id;
 RETURN v_snapshot||jsonb_build_object('quote_id',v_id,'expires_at',v_anchor+interval '10 minutes');
END $$;
REVOKE ALL ON FUNCTION public.referral_admin_quote_redemption(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_quote_redemption(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.referral_admin_commit_redemption(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q referral_private.quotes%rowtype; v_snapshot jsonb; v_item jsonb; v_tx uuid; v_order uuid; v_source uuid; v_item_id uuid; v_idx integer:=0; v_bonus bigint; v_meta jsonb;
BEGIN
 SELECT * INTO q FROM referral_private.quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.id IS NULL OR q.actor_id IS DISTINCT FROM auth.uid() OR NOT referral_private.allowed(auth.uid(),'referral.redeem') THEN RAISE EXCEPTION 'forbidden'; END IF;
 -- Shared payout advisory lock AND checkout row lock: neither path can spend concurrently.
 PERFORM pg_advisory_xact_lock(hashtextextended(q.partner_id::text,0));
 PERFORM 1 FROM public.referral_partners WHERE id=q.partner_id FOR UPDATE;
 IF q.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('redemption_id',q.id,'status','already_completed'); END IF;
 IF q.expires_at<=now() THEN RAISE EXCEPTION 'quote_expired'; END IF;
 v_snapshot:=referral_private.build_quote(auth.uid(),q.partner_id,q.request,q.anchor);
 IF v_snapshot IS DISTINCT FROM q.snapshot THEN RAISE EXCEPTION 'quote_stale'; END IF;
 INSERT INTO public.referral_redemptions(id,partner_id,profile_id,user_id,actor_id,reason,consent_reference,provider_acknowledged,total_minor,internal_minor,converted_cash_minor,subsidy_minor,snapshot)
 VALUES(q.id,q.partner_id,(q.snapshot->>'profile_id')::uuid,(q.snapshot->>'user_id')::uuid,auth.uid(),q.request->>'reason',q.request->>'consent_reference',coalesce((q.request->>'provider_acknowledged')::boolean,false),(q.snapshot->>'total_minor')::bigint,(q.snapshot->>'internal_minor')::bigint,(q.snapshot->>'converted_cash_minor')::bigint,(q.snapshot->>'subsidy_minor')::bigint,q.snapshot);
 v_meta:=jsonb_build_object('redemption_id',q.id,'actor_id',auth.uid(),'reason',q.request->>'reason','consent_reference',q.request->>'consent_reference');
 IF (q.snapshot->>'converted_cash_minor')::bigint>0 THEN
  INSERT INTO public.referral_balance_transactions(partner_id,transaction_type,idempotency_key,source_type,source_id,description,created_by,metadata)
  VALUES(q.partner_id,'manual_adjustment','referral:conversion:'||q.id,'referral_redemption',q.id,'Добровольная конвертация денежной части в бонусы',auth.uid(),v_meta||jsonb_build_object('reason_code','cash_to_internal_conversion')) RETURNING id INTO v_tx;
  INSERT INTO public.referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES
   (v_tx,q.partner_id,'available',-(q.snapshot->>'converted_cash_minor')::bigint),(v_tx,q.partner_id,'internal',(q.snapshot->>'converted_cash_minor')::bigint);
 END IF;
 v_bonus:=(q.snapshot->>'internal_minor')::bigint+(q.snapshot->>'converted_cash_minor')::bigint;
 IF v_bonus>0 THEN
  INSERT INTO public.referral_balance_transactions(partner_id,transaction_type,idempotency_key,source_type,source_id,description,created_by,metadata)
  VALUES(q.partner_id,'bonus_spend','referral:redeem:'||q.id,'referral_redemption',q.id,'Продукты за реферальные бонусы',auth.uid(),v_meta) RETURNING id INTO v_tx;
  INSERT INTO public.referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES(v_tx,q.partner_id,'internal',-v_bonus),(v_tx,q.partner_id,'internal_spent',v_bonus);
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(q.snapshot->'items') LOOP
  v_idx:=v_idx+1;
  -- Zero money order; the actual product value and split live in the redemption journal.
  INSERT INTO public.orders_v2(order_number,user_id,profile_id,product_id,tariff_id,offer_id,base_price,final_price,paid_amount,currency,status,is_trial,meta)
  VALUES('REF-'||upper(replace(q.id::text,'-',''))||'-'||v_idx,(q.snapshot->>'user_id')::uuid,(q.snapshot->>'profile_id')::uuid,(v_item->>'product_id')::uuid,(v_item->>'tariff_id')::uuid,(v_item->>'offer_id')::uuid,0,0,0,'BYN','paid',false,
   jsonb_build_object('source','referral_redemption','financial_kind','referral_redemption','redemption_id',q.id,'catalog_price_minor',v_item->'catalog_price_minor','redemption_price_minor',v_item->'price_minor','access_start',v_item->'starts_at','access_end',v_item->'expires_at','granted_by',auth.uid(),'prevent_commission_accrual',true,'suppress_notifications',true)) RETURNING id INTO v_order;
  INSERT INTO public.entitlement_sources(source_type,source_ref,user_id,profile_id,product_id,tariff_id,order_id,starts_at,expires_at,status,meta)
  VALUES('bonus','referral_redemption:'||q.id||':'||v_idx,(q.snapshot->>'user_id')::uuid,(q.snapshot->>'profile_id')::uuid,(v_item->>'product_id')::uuid,(v_item->>'tariff_id')::uuid,v_order,(v_item->>'starts_at')::timestamptz,(v_item->>'expires_at')::timestamptz,'active',
   jsonb_build_object('origin','referral_redemption','reason','referral_redemption','redemption_id',q.id,'product_name',v_item->'product_name','tariff_name',v_item->'tariff_name','price_minor',v_item->'price_minor')) RETURNING id INTO v_source;
  INSERT INTO public.referral_redemption_items(redemption_id,product_id,tariff_id,offer_id,order_id,source_id,price_minor,starts_at,expires_at,phase)
  VALUES(q.id,(v_item->>'product_id')::uuid,(v_item->>'tariff_id')::uuid,(v_item->>'offer_id')::uuid,v_order,v_source,(v_item->>'price_minor')::bigint,(v_item->>'starts_at')::timestamptz,(v_item->>'expires_at')::timestamptz,CASE WHEN (v_item->>'starts_at')::timestamptz>now() THEN 'scheduled' ELSE 'active' END) RETURNING id INTO v_item_id;
  PERFORM public.recalculate_entitlement_aggregate((q.snapshot->>'user_id')::uuid,(v_item->>'product_id')::uuid);
  INSERT INTO public.access_grant_ledger(source_event_key,action_type,status,reason_code,source_event_type,source_subject_type,source_subject_ref,target_type,target_key,target_ref,user_id,profile_id,order_id,source_offer_id,result,metadata)
  VALUES('referral:redemption:'||q.id||':'||v_idx,'grant','granted','admin_grant','admin','admin_action',q.id::text,'product',(q.snapshot->>'user_id')||':'||(v_item->>'product_id'),(v_item->>'product_id')::uuid,(q.snapshot->>'user_id')::uuid,(q.snapshot->>'profile_id')::uuid,v_order,(v_item->>'offer_id')::uuid,jsonb_build_object('source_id',v_source,'starts_at',v_item->'starts_at','expires_at',v_item->'expires_at'),v_meta||jsonb_build_object('reason_code','referral_redemption','subsidy_minor',q.snapshot->'subsidy_minor'));
  IF (v_item->>'starts_at')::timestamptz<=now() THEN
   INSERT INTO public.referral_redemption_outbox(item_id,event_key) VALUES(v_item_id,'referral:projection:'||v_item_id||':active');
  END IF;
 END LOOP;
 UPDATE referral_private.quotes SET consumed_at=now() WHERE id=q.id;
 RETURN jsonb_build_object('redemption_id',q.id,'status','completed','balances',referral_private.balance(q.partner_id));
END $$;
REVOKE ALL ON FUNCTION public.referral_admin_commit_redemption(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_commit_redemption(uuid) TO authenticated;

-- Explicitly exclude redemption in all callers of the attribution RPC.
create or replace function public.referral_process_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders_v2%rowtype; v_settings public.referral_program_settings%rowtype;
  v_relationship public.referral_relationships%rowtype; v_partner public.referral_partners%rowtype;
  v_product public.products_v2%rowtype; v_payment_id uuid; v_paid_minor bigint; v_basis_minor bigint;
  v_commission_minor bigint; v_sale_id uuid; v_tx_id uuid; v_status text; v_available_at timestamptz;
  v_commission_bps integer; v_scheme text; v_rank bigint; v_existing boolean; v_cash_minor bigint; v_internal_minor bigint;
begin
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.accrual_enabled, false) then return null; end if;
  select * into v_order from public.orders_v2 where id = p_order_id for update;
  if v_order.meta->>'financial_kind' = 'referral_redemption' then return null; end if;
  if v_order.id is null or v_order.status::text <> 'paid' or coalesce(v_order.is_deleted, false) then return null; end if;
  if coalesce(v_order.currency, '') <> 'BYN' or coalesce(v_order.paid_amount, 0) <= 0 then return null; end if;
  if coalesce(v_order.meta->>'split_from_order_id', '') <> '' or coalesce(v_order.meta->>'is_test', 'false') = 'true' or coalesce(v_order.meta->>'sandbox', 'false') = 'true' then return null; end if;
  if exists (select 1 from public.referral_sale_attributions where order_id = p_order_id) then
    select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
  end if;
  if exists (select 1 from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and coalesce(is_recurring, false)) then return null; end if;
  select (array_agg(id order by paid_at nulls last, created_at))[1], coalesce(sum(round(amount * 100)::bigint), 0)
    into v_payment_id, v_paid_minor from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and not coalesce(is_recurring, false) and not coalesce(is_deleted, false);
  if v_paid_minor <= 0 then return null; end if;
  select * into v_relationship from public.referral_relationships where referred_profile_id = v_order.profile_id and status = 'active' order by attached_at, id limit 1;
  if v_relationship.id is null then return null; end if;
  select * into v_partner from public.referral_partners where id = v_relationship.partner_id and status = 'active';
  if v_partner.id is null or v_partner.profile_id = v_order.profile_id then return null; end if;
  select * into v_product from public.products_v2 where id = v_order.product_id;
  if v_product.id is null or v_product.referral_settings_mode = 'disabled' then return null; end if;

  v_scheme := coalesce(v_product.referral_commission_scheme, v_settings.commission_scheme, 'flat');
  if v_scheme = 'club_first_payment' then
    select exists (select 1 from public.referral_sale_attributions rsa where rsa.relationship_id = v_relationship.id and rsa.product_id = v_order.product_id) into v_existing;
    if v_existing then return null; end if;
    v_commission_bps := coalesce(v_product.referral_club_first_payment_percent_bps, v_product.referral_commission_percent_bps, v_settings.club_first_payment_percent_bps);
  elsif v_scheme = 'tiered' then
    select count(*) + 1 into v_rank from public.referral_relationships rr where rr.partner_id = v_relationship.partner_id and rr.status = 'active'
      and (rr.attached_at, rr.id) < (v_relationship.attached_at, v_relationship.id);
    v_commission_bps := case
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) then coalesce(v_product.referral_tier_1_commission_percent_bps, v_settings.tier_1_commission_percent_bps)
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) + coalesce(v_product.referral_tier_2_limit, v_settings.tier_2_limit) then coalesce(v_product.referral_tier_2_commission_percent_bps, v_settings.tier_2_commission_percent_bps)
      else coalesce(v_product.referral_tier_3_commission_percent_bps, v_settings.tier_3_commission_percent_bps) end;
  else
    v_commission_bps := case v_product.referral_settings_mode when 'custom' then coalesce(v_product.referral_commission_percent_bps, v_settings.commission_percent_bps) else v_settings.commission_percent_bps end;
  end if;
  v_commission_bps := greatest(0, least(10000, coalesce(v_commission_bps, 0)));
  v_basis_minor := least(round(v_order.paid_amount * 100)::bigint, v_paid_minor);
  v_commission_minor := round(v_basis_minor * v_commission_bps::numeric / 10000)::bigint;
  if v_basis_minor <= 0 or v_commission_minor <= 0 then return null; end if;
  v_status := case when v_settings.shadow_mode then 'shadow' else 'pending' end;
  v_available_at := now() + make_interval(days => v_settings.hold_days);
  insert into public.referral_sale_attributions(partner_id, relationship_id, order_id, payment_id, product_id, tariff_id, offer_id, status,
    commission_basis_minor, commission_basis_currency, commission_percent_bps, commission_minor, available_at, rule_snapshot, order_snapshot)
  values (v_partner.id, v_relationship.id, v_order.id, v_payment_id, v_order.product_id, v_order.tariff_id, v_order.offer_id, v_status,
    v_basis_minor, 'BYN', v_commission_bps, v_commission_minor, v_available_at,
    jsonb_build_object('commission_percent_bps', v_commission_bps, 'scheme', v_scheme, 'relationship_rank', v_rank,
      'hold_days', v_settings.hold_days, 'split_60_40_enabled', v_settings.split_60_40_enabled,
      'withdrawable_percent_bps', v_settings.withdrawable_percent_bps, 'version', 4),
    jsonb_build_object('order_id', v_order.id, 'paid_amount', v_order.paid_amount, 'currency', v_order.currency, 'product_id', v_order.product_id, 'tariff_id', v_order.tariff_id, 'offer_id', v_order.offer_id))
  returning id into v_sale_id;
  if not v_settings.shadow_mode then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_partner.id, 'commission_pending', 'referral:commission:' || v_sale_id, 'sale_attribution', v_sale_id, trim(trailing '0' from trim(trailing '.' from (v_commission_bps::numeric / 100)::text)) || '% за покупку приглашённого') returning id into v_tx_id;
    v_cash_minor := case when v_settings.split_60_40_enabled then round(v_commission_minor * v_settings.withdrawable_percent_bps::numeric / 10000)::bigint else v_commission_minor end;
    v_internal_minor := v_commission_minor - v_cash_minor;
    if v_cash_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'pending', v_cash_minor); end if;
    if v_internal_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'internal_pending', v_internal_minor); end if;
  end if;
  perform public.referral_emit_event('referral.commission.' || v_status, v_sale_id, jsonb_build_object('partner_id', v_partner.id, 'order_id', v_order.id, 'commission_minor', v_commission_minor, 'currency', 'BYN'));
  return v_sale_id;
exception when unique_violation then select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
end $$;
revoke all on function public.referral_process_order(uuid) from public;
grant execute on function public.referral_process_order(uuid) to service_role;

-- All ledger writers serialize on the same partner lock, including refunds/repairs.
CREATE OR REPLACE FUNCTION referral_private.serialize_wallet_writer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.partner_id::text,0));
 PERFORM 1 FROM public.referral_partners WHERE id=NEW.partner_id FOR UPDATE;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION referral_private.serialize_wallet_writer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER referral_wallet_serialize BEFORE INSERT ON public.referral_balance_transactions
FOR EACH ROW EXECUTE FUNCTION referral_private.serialize_wallet_writer();

create or replace function public.referral_reserve_partner_bonus(
  p_user_id uuid, p_requested_minor bigint, p_charge_amount_minor bigint,
  p_checkout_key text, p_product_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_partner_id uuid; v_available bigint; v_apply bigint; v_existing public.referral_bonus_reservations%rowtype; v_tx uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_requested_minor <= 0 or p_charge_amount_minor <= 100 then return jsonb_build_object('applied_minor', 0); end if;
  if not exists (select 1 from public.referral_program_settings s where s.singleton and s.is_enabled and s.partner_bonus_enabled)
     or exists (select 1 from public.products_v2 p where p.id = p_product_id and (p.referral_bonus_eligible = false or p.referral_settings_mode = 'disabled')) then
    return jsonb_build_object('applied_minor', 0, 'eligible', false);
  end if;
  select * into v_existing from public.referral_bonus_reservations where checkout_key = p_checkout_key;
  if v_existing.id is not null then return jsonb_build_object('applied_minor', v_existing.amount_minor, 'reservation_id', v_existing.id); end if;
  select rp.id into v_partner_id from public.referral_partners rp join public.profiles p on p.id = rp.profile_id
    where p.user_id = p_user_id and rp.status = 'active';
  if v_partner_id is null then return jsonb_build_object('applied_minor', 0); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_partner_id::text,0));
  perform 1 from public.referral_partners where id=v_partner_id for update;
  -- Expired reservations remain held until a compensating release is recorded.
  -- Do not mark them released without restoring their balance entries.
  -- Reservations have already moved internal -> internal_held; do not subtract twice.
  select greatest(coalesce(sum(amount_minor) filter (where bucket = 'internal'), 0), 0)
    into v_available from public.referral_balance_entries where partner_id = v_partner_id;
  v_apply := least(p_requested_minor, v_available, greatest(p_charge_amount_minor - 100, 0));
  if v_apply <= 0 then return jsonb_build_object('applied_minor', 0); end if;
  insert into public.referral_bonus_reservations(partner_id, amount_minor, checkout_key, product_id)
    values (v_partner_id, v_apply, p_checkout_key, p_product_id) returning * into v_existing;
  insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
    values (v_partner_id, 'bonus_reserve', 'referral:bonus:reserve:' || v_existing.id, 'bonus_reservation', v_existing.id, 'Резерв внутреннего бонуса') returning id into v_tx;
  insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
    values (v_tx, v_partner_id, 'internal', -v_apply), (v_tx, v_partner_id, 'internal_held', v_apply);
  return jsonb_build_object('applied_minor', v_apply, 'reservation_id', v_existing.id);
end $$;
revoke all on function public.referral_reserve_partner_bonus(uuid, bigint, bigint, text, uuid) from public;
grant execute on function public.referral_reserve_partner_bonus(uuid, bigint, bigint, text, uuid) to service_role;

create or replace function public.referral_mature_due_commissions(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sale public.referral_sale_attributions%rowtype; v_tx uuid; v_count integer := 0; v_remaining bigint;
  v_cash bigint; v_internal bigint; v_withdrawable_bps integer; v_split boolean;
begin
  if not (public.referral_is_admin(auth.uid()) or coalesce(auth.jwt()->>'role', '') = 'service_role') then raise exception 'forbidden'; end if;
  for v_sale in select * from public.referral_sale_attributions
    where status in ('pending', 'partially_reversed') and available_at <= now() and not exists(select 1 from public.referral_balance_transactions bt where bt.idempotency_key='referral:mature:'||referral_sale_attributions.id) order by available_at for update skip locked limit least(greatest(p_limit, 1), 2000)
  loop
    v_tx := null;
    v_remaining := v_sale.commission_minor - v_sale.reversed_minor;
    if v_remaining > 0 then
      insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_sale.partner_id, 'commission_available', 'referral:mature:' || v_sale.id, 'sale_attribution', v_sale.id, 'Комиссия доступна к выплате')
      on conflict (idempotency_key) do nothing returning id into v_tx;
      if v_tx is not null then
        v_split := coalesce((v_sale.rule_snapshot->>'split_60_40_enabled')::boolean, false);
        v_withdrawable_bps := coalesce((v_sale.rule_snapshot->>'withdrawable_percent_bps')::integer, 10000);
        v_cash := case when v_split then
            round(v_sale.commission_minor * v_withdrawable_bps::numeric / 10000)::bigint
            - round(v_sale.reversed_minor * v_withdrawable_bps::numeric / 10000)::bigint
          else v_remaining end;
        v_internal := v_remaining - v_cash;
        if v_cash > 0 then
          insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
          values (v_tx, v_sale.partner_id, 'pending', -v_cash), (v_tx, v_sale.partner_id, 'available', v_cash);
        end if;
        if v_internal > 0 then
          insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
          values (v_tx, v_sale.partner_id, 'internal_pending', -v_internal), (v_tx, v_sale.partner_id, 'internal', v_internal);
        end if;
      end if;
    end if;
    update public.referral_sale_attributions set status = case when v_remaining > 0 then 'available' else 'reversed' end, updated_at = now() where id = v_sale.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

REVOKE ALL ON FUNCTION public.referral_mature_due_commissions(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.referral_mature_due_commissions(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_admin_reverse_redemption(p_redemption_id uuid,p_reason text,p_allow_consumed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.referral_redemptions%rowtype; i public.referral_redemption_items%rowtype; v_tx uuid; v_bonus bigint;
BEGIN
 IF NOT referral_private.allowed(auth.uid(),'referral.reverse_redemption') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'reason_required'; END IF;
 SELECT * INTO r FROM public.referral_redemptions WHERE id=p_redemption_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'redemption_not_found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.partner_id::text,0));
 PERFORM 1 FROM public.referral_partners WHERE id=r.partner_id FOR UPDATE;
 IF r.status='reversed' THEN RETURN jsonb_build_object('status','already_reversed'); END IF;
 IF EXISTS(SELECT 1 FROM public.referral_redemption_items WHERE redemption_id=r.id AND starts_at<=now()) AND NOT p_allow_consumed THEN RAISE EXCEPTION 'consumed_access_requires_explicit_decision'; END IF;
 v_bonus:=r.internal_minor+r.converted_cash_minor;
 INSERT INTO public.referral_balance_transactions(partner_id,transaction_type,idempotency_key,source_type,source_id,description,created_by,metadata)
 VALUES(r.partner_id,'manual_adjustment','referral:redeem:reverse:'||r.id,'referral_redemption',r.id,'Отмена реферальной выдачи',auth.uid(),jsonb_build_object('reason_code','referral_redemption_reversal','reason',p_reason,'allow_consumed',p_allow_consumed,'subsidy_reversed_minor',r.subsidy_minor)) RETURNING id INTO v_tx;
 IF r.internal_minor>0 THEN INSERT INTO public.referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES(v_tx,r.partner_id,'internal',r.internal_minor); END IF;
 IF r.converted_cash_minor>0 THEN INSERT INTO public.referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES(v_tx,r.partner_id,'available',r.converted_cash_minor); END IF;
 IF v_bonus>0 THEN INSERT INTO public.referral_balance_entries(transaction_id,partner_id,bucket,amount_minor) VALUES(v_tx,r.partner_id,'internal_spent',-v_bonus); END IF;
 FOR i IN SELECT * FROM public.referral_redemption_items WHERE redemption_id=r.id ORDER BY product_id FOR UPDATE LOOP
  UPDATE public.entitlement_sources SET status='revoked',revoked_at=now(),revocation_reason=p_reason WHERE id=i.source_id AND meta->>'redemption_id'=r.id::text;
  PERFORM public.recalculate_entitlement_aggregate(r.user_id,i.product_id);
  UPDATE public.referral_redemption_items SET phase='revoked' WHERE id=i.id;
  INSERT INTO public.referral_redemption_outbox(item_id,event_key) VALUES(i.id,'referral:projection:'||i.id||':revoked') ON CONFLICT(event_key) DO NOTHING;
  INSERT INTO public.access_grant_ledger(source_event_key,action_type,status,reason_code,source_event_type,source_subject_type,source_subject_ref,target_type,target_key,target_ref,user_id,profile_id,order_id,result,metadata)
  VALUES('referral:reverse:'||i.id,'revoke','revoked','admin_revoke','admin','admin_action',r.id::text,'product',r.user_id||':'||i.product_id,i.product_id,r.user_id,r.profile_id,i.order_id,jsonb_build_object('source_id',i.source_id),jsonb_build_object('reason_code','referral_redemption_reversal','actor_id',auth.uid(),'reason',p_reason));
 END LOOP;
 UPDATE public.referral_redemptions SET status='reversed',reversed_at=now(),reversed_by=auth.uid(),reversal_reason=p_reason WHERE id=r.id;
 RETURN jsonb_build_object('status','reversed','balances',referral_private.balance(r.partner_id));
END $$;
REVOKE ALL ON FUNCTION public.referral_admin_reverse_redemption(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_reverse_redemption(uuid,text,boolean) TO authenticated;

-- Scheduled activation/expiry uses the existing aggregate, never a provider subscription.
CREATE OR REPLACE FUNCTION public.referral_redemption_tick(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i record; n integer:=0; matured integer:=0;
BEGIN
 FOR i IN SELECT ri.*,r.user_id FROM public.referral_redemption_items ri JOIN public.referral_redemptions r ON r.id=ri.redemption_id
  WHERE r.status='completed' AND ((ri.phase='scheduled' AND ri.starts_at<=now()) OR (ri.phase='active' AND ri.expires_at<=now()))
  ORDER BY ri.expires_at,ri.id LIMIT least(greatest(p_limit,1),500) FOR UPDATE OF ri SKIP LOCKED LOOP
  IF i.expires_at<=now() THEN
   UPDATE public.entitlement_sources SET status='expired' WHERE id=i.source_id AND status='active';
   UPDATE public.referral_redemption_items SET phase='expired' WHERE id=i.id;
  ELSE UPDATE public.referral_redemption_items SET phase='active' WHERE id=i.id; END IF;
  PERFORM public.recalculate_entitlement_aggregate(i.user_id,i.product_id);
  INSERT INTO public.referral_redemption_outbox(item_id,event_key) VALUES(i.id,'referral:projection:'||i.id||CASE WHEN i.expires_at<=now() THEN ':expired' ELSE ':active' END) ON CONFLICT(event_key) DO NOTHING;
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('items_updated',n);
END $$;
REVOKE ALL ON FUNCTION public.referral_redemption_tick(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.referral_redemption_tick(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_redemption_claim_outbox(p_limit integer DEFAULT 20)
RETURNS SETOF public.referral_redemption_outbox LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE public.referral_redemption_outbox o SET status='processing',attempts=o.attempts+1,leased_until=now()+interval '5 minutes'
 WHERE id IN (SELECT id FROM public.referral_redemption_outbox WHERE
 ((status IN ('pending','failed') AND available_at<=now()) OR (status='processing' AND leased_until<=now()))
 ORDER BY created_at LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED) RETURNING o.*
$$;
REVOKE ALL ON FUNCTION public.referral_redemption_claim_outbox(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.referral_redemption_claim_outbox(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_admin_redemption_context(p_partner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT referral_private.allowed(auth.uid(),'referral.redeem') THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT jsonb_build_object('balances',referral_private.balance(rp.id),'registered',p.user_id IS NOT NULL,
 'permissions',jsonb_build_object('convert_cash',referral_private.allowed(auth.uid(),'referral.convert_cash'),'subsidy',referral_private.allowed(auth.uid(),'referral.subsidy'),'override_catalog',referral_private.allowed(auth.uid(),'referral.override_catalog'),'reverse',referral_private.allowed(auth.uid(),'referral.reverse_redemption')),
 'catalog',coalesce((SELECT jsonb_agg(jsonb_build_object('product_id',pr.id,'product_name',pr.name,'tariff_id',t.id,'tariff_name',t.name,'offer_id',o.id,'amount_minor',round(o.amount*100)::bigint,'recurring',coalesce(o.meta->'recurring',o.meta),'eligible',coalesce(pr.referral_bonus_eligible,true) AND pr.referral_settings_mode IS DISTINCT FROM 'disabled') ORDER BY pr.name,t.name,o.amount)
 FROM public.products_v2 pr JOIN public.tariffs t ON t.product_id=pr.id JOIN public.tariff_offers o ON o.tariff_id=t.id WHERE pr.is_active AND t.is_active AND o.is_active),'[]'),
 'provider_product_ids',coalesce((SELECT jsonb_agg(DISTINCT s.product_id) FROM public.subscriptions_v2 s WHERE s.user_id=p.user_id AND (coalesce(s.auto_renew,false) OR nullif(s.meta->>'bepaid_subscription_id','') IS NOT NULL OR nullif(s.meta->>'stripe_subscription_id','') IS NOT NULL)),'[]'),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC) FROM (
 SELECT r.id,r.created_at,r.status,r.total_minor,r.internal_minor,r.converted_cash_minor,r.subsidy_minor,r.reason,r.actor_id,r.snapshot->'items' items,
 (SELECT full_name FROM public.profiles WHERE user_id=r.actor_id ORDER BY created_at LIMIT 1) actor_name,
 (SELECT count(*) FROM public.referral_redemption_outbox ob JOIN public.referral_redemption_items ri ON ri.id=ob.item_id WHERE ri.redemption_id=r.id AND ob.status<>'done') pending_projections
 FROM public.referral_redemptions r WHERE r.partner_id=rp.id ORDER BY r.created_at DESC LIMIT 50) h),'[]')) INTO v_result
 FROM public.referral_partners rp JOIN public.profiles p ON p.id=rp.profile_id WHERE rp.id=p_partner_id;
 IF v_result IS NULL THEN RAISE EXCEPTION 'partner_not_found'; END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.referral_admin_redemption_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_redemption_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.referral_get_my_redemptions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM (
 SELECT r.id,r.created_at,r.status,r.total_minor,r.internal_minor+r.converted_cash_minor bonus_minor,r.subsidy_minor,
 (SELECT jsonb_agg(jsonb_build_object('product_name',s.meta->>'product_name','tariff_name',s.meta->>'tariff_name','starts_at',i.starts_at,'expires_at',i.expires_at,'phase',i.phase) ORDER BY i.id)
 FROM public.referral_redemption_items i JOIN public.entitlement_sources s ON s.id=i.source_id WHERE i.redemption_id=r.id) items
 FROM public.referral_redemptions r WHERE r.user_id=auth.uid() ORDER BY r.created_at DESC LIMIT 50) x
$$;
REVOKE ALL ON FUNCTION public.referral_get_my_redemptions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_get_my_redemptions() TO authenticated;
