-- CB2: a historical purchase is a fact; the Club bonus has the real Club window.
-- No financial rows, access dates or existing grants are mutated by this migration.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.cb2_purchase_proof(u uuid)
RETURNS TABLE(order_id uuid, tariff_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT o.id, o.tariff_id FROM public.orders_v2 o
  WHERE o.product_id='87a8870f-d426-419a-9f15-faa76c3f2be3'::uuid
    AND o.status::text='paid' AND o.is_deleted IS NOT TRUE AND NOT coalesce(o.is_trial,false)
    AND (o.user_id=u OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=o.profile_id AND p.user_id=u))
    AND coalesce(o.meta->>'financial_kind','') NOT IN ('referral_redemption','gift','test','sandbox')
    AND coalesce(o.meta->>'is_test','false')<>'true'
    AND coalesce(o.meta->>'is_gift','false')<>'true'
    AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected'
    AND NOT EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id
      AND (p.status::text='refunded' OR (p.amount>0 AND p.refunded_amount>=p.amount)))
  ORDER BY (o.tariff_id IS NOT NULL) DESC, o.created_at, o.id;
$fn$;
REVOKE ALL ON FUNCTION private.cb2_purchase_proof(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.cb2_access_sources(u uuid, at_time timestamptz)
RETURNS TABLE(source_kind text, source_id uuid, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH proof AS (SELECT * FROM private.cb2_purchase_proof(u)),
  club_windows AS (
    SELECT s.id,s.product_id,s.tariff_id,s.access_end_at ends_at FROM public.subscriptions_v2 s
    WHERE s.user_id=u AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
      AND s.tariff_id=ANY(ARRAY['7c748940-dcad-4c7c-a92e-76a2344622d3','b018e9be-53ce-4840-8034-e09f8e319080']::uuid[])
      AND s.status::text IN ('active','past_due','canceled') AND NOT coalesce(s.is_trial,false)
      AND s.access_start_at<=at_time AND s.access_end_at>at_time
    UNION ALL
    SELECT s.id,s.product_id,s.tariff_id,s.expires_at FROM public.entitlement_sources s
    WHERE s.user_id=u AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
      AND s.tariff_id=ANY(ARRAY['7c748940-dcad-4c7c-a92e-76a2344622d3','b018e9be-53ce-4840-8034-e09f8e319080']::uuid[])
      AND s.status='active' AND s.starts_at<=at_time AND s.expires_at>at_time
      AND s.source_type='bonus' AND s.meta->>'origin'=ANY(ARRAY['upsert_club_bonus_entitlement_source','controlled_cb20_bonus_backfill_20260810'])
  )
  -- The original purchase remains independent of Club rebilling and tariff changes.
  SELECT 'purchase'::text,s.id,s.access_end_at FROM public.subscriptions_v2 s
  WHERE s.user_id=u AND s.product_id='87a8870f-d426-419a-9f15-faa76c3f2be3'
    AND s.status::text IN ('active','trial','past_due','canceled')
    AND s.access_start_at<=at_time AND (s.access_end_at IS NULL OR s.access_end_at>at_time)
  UNION ALL
  SELECT CASE WHEN es.source_type='manual_grant' THEN 'manual' ELSE 'paid_source' END,es.id,es.expires_at
  FROM public.entitlement_sources es
  WHERE es.user_id=u AND es.product_id='87a8870f-d426-419a-9f15-faa76c3f2be3'
    AND es.status='active' AND es.starts_at<=at_time AND (es.expires_at IS NULL OR es.expires_at>at_time)
    AND (es.source_type='manual_grant' OR (
      es.source_type IN ('order','subscription','upgrade','migration')
      AND EXISTS(SELECT 1 FROM proof p WHERE p.order_id=es.order_id)))
  UNION ALL
  SELECT 'manual',e.id,e.expires_at FROM public.entitlements e
  WHERE e.user_id=u AND e.product_id='87a8870f-d426-419a-9f15-faa76c3f2be3'
    AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at>at_time)
    AND (e.meta->>'source_type' IN ('manual','admin') OR e.meta->>'granted_by' IN ('manual','admin','manual_grant','admin_manual'))
    AND coalesce(e.meta->>'granted_by','')<>'rule_engine_product_access'
  UNION ALL
  SELECT 'paid_source',e.id,e.expires_at FROM public.entitlements e
  WHERE e.user_id=u AND e.product_id='87a8870f-d426-419a-9f15-faa76c3f2be3'
    AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at>at_time)
    AND EXISTS(SELECT 1 FROM proof p WHERE p.order_id=e.order_id)
    AND (e.meta->>'granted_by'='primary_order_fulfillment' OR (
      NOT(coalesce(e.meta,'{}') ?| ARRAY['source_rule_id','business_subscription_id','source_entitlement_source_id'])
      AND coalesce(e.meta->>'granted_by','')<>'rule_engine_product_access'))
  UNION ALL
  SELECT 'club_bonus',s.id,s.ends_at FROM club_windows s
  WHERE EXISTS(SELECT 1 FROM proof)
    AND EXISTS(SELECT 1 FROM public.access_rules ar
      WHERE ar.is_active AND ar.grant_target_type='product_access'
        AND ar.product_id=s.product_id AND ar.tariff_id=s.tariff_id
        AND ar.duration_days IS NULL AND ar.conditions->>'condition_type'='prior_purchase'
        AND ar.conditions->>'match_mode'='per_product'
        AND coalesce(ar.conditions->>'required_product_id','') IN ('','87a8870f-d426-419a-9f15-faa76c3f2be3')
        AND (ar.conditions->'target_product_ids') ? '87a8870f-d426-419a-9f15-faa76c3f2be3'
        AND (NOT(coalesce(ar.conditions,'{}') ? 'required_product_ids')
          OR ar.conditions->'required_product_ids'='[]'::jsonb
          OR (ar.conditions->'required_product_ids') ? '87a8870f-d426-419a-9f15-faa76c3f2be3'));
$fn$;
REVOKE ALL ON FUNCTION private.cb2_access_sources(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_cb2_access_window(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE result jsonb; proof record;
BEGIN
  IF _user_id IS NULL OR (auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM _user_id
    AND NOT coalesce(public.has_role_v2(auth.uid(),'admin'),false)
    AND NOT coalesce(public.has_role_v2(auth.uid(),'super_admin'),false)
    AND NOT coalesce(public.has_permission(auth.uid(),'entitlements.view'),false)
    AND NOT coalesce(public.has_admin_section_access(auth.uid(),'contacts','view'),false))
  THEN RAISE EXCEPTION 'access_window_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO proof FROM private.cb2_purchase_proof(_user_id) LIMIT 1;
  WITH sources AS (SELECT * FROM private.cb2_access_sources(_user_id,now()))
  SELECT jsonb_build_object(
    'has_access',EXISTS(SELECT 1 FROM sources),
    'effective_end_at',(SELECT ends_at FROM sources ORDER BY ends_at DESC NULLS FIRST,source_kind LIMIT 1),
    'source_kind',(SELECT source_kind FROM sources ORDER BY ends_at DESC NULLS FIRST,source_kind LIMIT 1),
    'club_bonus_end_at',(SELECT max(ends_at) FROM sources WHERE source_kind='club_bonus'),
    'has_prior_purchase',proof.order_id IS NOT NULL,
    'prior_order_id',proof.order_id,'prior_tariff_id',proof.tariff_id
  ) INTO result;
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_cb2_access_window(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_cb2_access_window(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.cb2_module_in_scope(m uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  WITH RECURSIVE ancestors AS (
    SELECT id,parent_module_id,product_id,ARRAY[id] seen FROM public.training_modules WHERE id=m
    UNION ALL SELECT tm.id,tm.parent_module_id,tm.product_id,a.seen||tm.id
      FROM public.training_modules tm JOIN ancestors a ON tm.id=a.parent_module_id
      WHERE NOT tm.id=ANY(a.seen) AND cardinality(a.seen)<50
  ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE product_id='87a8870f-d426-419a-9f15-faa76c3f2be3');
$fn$;
REVOKE ALL ON FUNCTION private.cb2_module_in_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.cb2_user_allowed(u uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT u IS NOT NULL AND (coalesce(public.has_role_v2(u,'admin'),false)
    OR coalesce(public.has_role_v2(u,'super_admin'),false)
    OR coalesce(public.has_permission(u,'content.manage'),false)
    OR EXISTS(SELECT 1 FROM private.cb2_access_sources(u,now())));
$fn$;
REVOKE ALL ON FUNCTION private.cb2_user_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cb2_module_access_guard(_module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT NOT private.cb2_module_in_scope(_module_id) OR private.cb2_user_allowed(auth.uid());
$fn$;
CREATE OR REPLACE FUNCTION public.cb2_lesson_access_guard(_lesson_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce((SELECT NOT private.cb2_module_in_scope(l.module_id) OR private.cb2_user_allowed(auth.uid())
    FROM public.training_lessons l WHERE l.id=_lesson_id),false);
$fn$;
CREATE OR REPLACE FUNCTION public.cb2_entitlement_access_guard(_user_id uuid,_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT _product_id IS DISTINCT FROM '87a8870f-d426-419a-9f15-faa76c3f2be3'::uuid
    OR (auth.uid()=_user_id AND private.cb2_user_allowed(_user_id))
    OR coalesce(public.has_role_v2(auth.uid(),'admin'),false)
    OR coalesce(public.has_role_v2(auth.uid(),'super_admin'),false)
    OR coalesce(public.has_permission(auth.uid(),'entitlements.view'),false)
    OR coalesce(public.has_admin_section_access(auth.uid(),'contacts','view'),false);
$fn$;
REVOKE ALL ON FUNCTION public.cb2_module_access_guard(uuid),public.cb2_lesson_access_guard(uuid),public.cb2_entitlement_access_guard(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cb2_module_access_guard(uuid),public.cb2_lesson_access_guard(uuid),public.cb2_entitlement_access_guard(uuid,uuid) TO anon,authenticated,service_role;

-- Preserve the entire existing CB21/legacy authorization implementation, unchanged.
DO $wrap$
DECLARE definition text;
BEGIN
  IF to_regprocedure('private.training_lesson_access_before_cb2(uuid,uuid)') IS NULL THEN
    SELECT pg_get_functiondef('public.user_has_training_lesson_access(uuid,uuid)'::regprocedure) INTO definition;
    IF definition IS NULL OR position('training_lesson_access_before_cb2' IN definition)>0 THEN RAISE EXCEPTION 'cb2_baseline_mismatch'; END IF;
    EXECUTE replace(definition,'public.user_has_training_lesson_access(', 'private.training_lesson_access_before_cb2(');
  END IF;
END;
$wrap$;
REVOKE ALL ON FUNCTION private.training_lesson_access_before_cb2(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(_user_id uuid,_lesson_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF EXISTS(SELECT 1 FROM public.training_lessons l WHERE l.id=_lesson_id AND private.cb2_module_in_scope(l.module_id)) THEN
    IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM _user_id
      AND NOT coalesce(public.has_role_v2(auth.uid(),'admin'),false)
      AND NOT coalesce(public.has_role_v2(auth.uid(),'super_admin'),false)
    THEN RETURN false; END IF;
    IF NOT private.cb2_user_allowed(_user_id) THEN RETURN false; END IF;
  END IF;
  RETURN private.training_lesson_access_before_cb2(_user_id,_lesson_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) FROM PUBLIC,anon;
-- Existing public lesson policies call this resolver for anon too.
GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) TO anon,authenticated,service_role;

DROP POLICY IF EXISTS cb2_purchased_access ON public.training_modules;
CREATE POLICY cb2_purchased_access ON public.training_modules AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.cb2_module_access_guard(id));
DROP POLICY IF EXISTS cb2_purchased_access ON public.training_lessons;
CREATE POLICY cb2_purchased_access ON public.training_lessons AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.cb2_lesson_access_guard(id));
DROP POLICY IF EXISTS cb2_purchased_access ON public.lesson_blocks;
CREATE POLICY cb2_purchased_access ON public.lesson_blocks AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.cb2_lesson_access_guard(lesson_id));
DROP POLICY IF EXISTS cb2_purchased_access ON public.lesson_attachments;
CREATE POLICY cb2_purchased_access ON public.lesson_attachments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.cb2_lesson_access_guard(lesson_id));
DROP POLICY IF EXISTS cb2_purchased_access ON public.entitlements;
CREATE POLICY cb2_purchased_access ON public.entitlements AS RESTRICTIVE FOR SELECT TO authenticated USING(public.cb2_entitlement_access_guard(user_id,product_id));

-- Controlled correction of an imported zero-price historical fact. Parameters
-- carry the separately confirmed source, never a fabricated bank transaction.
CREATE OR REPLACE FUNCTION public.repair_cb2_historical_order(
  p_order_id uuid, p_confirmed_total numeric, p_source jsonb,
  p_confirmation_ref text, p_execute boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE o public.orders_v2%ROWTYPE; provenance jsonb; changed integer;
BEGIN
  IF p_confirmed_total IS NULL OR p_confirmed_total<=0 OR p_confirmed_total::text IN ('NaN','Infinity','-Infinity')
    OR coalesce(p_source->>'identity_confirmed_by_owner','false')<>'true'
    OR coalesce(p_source->>'full_payment_confirmed_by_owner','false')<>'true'
    OR nullif(p_confirmation_ref,'') IS NULL OR length(p_confirmation_ref)>200
    OR nullif(p_source->>'source_document_id','') IS NULL OR coalesce((p_source->>'source_row')::integer,0)<1
  THEN RAISE EXCEPTION 'cb2_historical_source_confirmation_required'; END IF;
  IF p_execute THEN SELECT * INTO o FROM public.orders_v2 WHERE id=p_order_id FOR UPDATE;
  ELSE SELECT * INTO o FROM public.orders_v2 WHERE id=p_order_id; END IF;
  IF NOT FOUND OR o.product_id IS DISTINCT FROM '87a8870f-d426-419a-9f15-faa76c3f2be3'::uuid
    OR o.status::text<>'paid' OR o.is_deleted IS TRUE OR coalesce(o.is_trial,false)
    OR o.reconcile_source IS DISTINCT FROM 'getcourse_historical'
    OR o.currency IS DISTINCT FROM p_source->>'currency'
  THEN RAISE EXCEPTION 'cb2_historical_order_scope_mismatch'; END IF;
  IF o.meta#>>'{historical_provenance,confirmation_ref}'=p_confirmation_ref
    AND o.base_price=p_confirmed_total AND o.final_price=p_confirmed_total AND o.paid_amount=p_confirmed_total
  THEN RETURN jsonb_build_object('dry_run',NOT p_execute,'changed',0,'already_applied',true); END IF;
  IF coalesce(o.base_price,0)<>0 OR coalesce(o.final_price,0)<>0 OR coalesce(o.paid_amount,0)<>0 OR coalesce(o.discount_percent,0)<>0
    OR EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id)
    OR EXISTS(SELECT 1 FROM public.subscriptions_v2 s WHERE s.order_id=o.id)
  THEN RAISE EXCEPTION 'cb2_historical_order_baseline_mismatch'; END IF;
  provenance:=jsonb_build_object(
    'source_document_id',p_source->>'source_document_id','source_sheet_id',p_source->>'source_sheet_id',
    'source_row',(p_source->>'source_row')::integer,'source_date_label',p_source->>'source_date_label',
    'source_date_role_unverified',true,'recorded_first_payment',p_source->'recorded_first_payment',
    'identity_confirmed_by_owner',true,'full_payment_confirmed_by_owner',true,
    'confirmation_ref',p_confirmation_ref,'confirmed_at',now(),
    'supersedes_import_row_label',o.meta->'source_row','financial_transactions_created',false);
  IF NOT p_execute THEN RETURN jsonb_build_object('dry_run',true,'changed',1,'already_applied',false,
    'payments_to_create',0,'subscriptions_to_create',0,'grants_to_change',0); END IF;
  UPDATE public.orders_v2 SET base_price=p_confirmed_total,final_price=p_confirmed_total,paid_amount=p_confirmed_total,
    meta=coalesce(meta,'{}')||jsonb_build_object('historical_provenance',provenance),updated_at=now()
    WHERE id=o.id AND coalesce(base_price,0)=0 AND coalesce(final_price,0)=0 AND coalesce(paid_amount,0)=0;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'cb2_historical_order_changed_during_repair'; END IF;
  INSERT INTO public.audit_logs(actor_type,actor_label,action,entity_type,entity_id,meta)
  VALUES('system','cb2-historical-order-repair','cb2.historical_order.repaired','order',o.id::text,
    jsonb_build_object('confirmation_ref',p_confirmation_ref,'before',jsonb_build_object('base_price',o.base_price,'final_price',o.final_price,'paid_amount',o.paid_amount),
      'confirmed_total',p_confirmed_total,'currency',o.currency,'payments_created',0,'grants_changed',0));
  RETURN jsonb_build_object('dry_run',false,'changed',changed,'already_applied',false,
    'payments_created',0,'subscriptions_created',0,'grants_changed',0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.repair_cb2_historical_order(uuid,numeric,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_cb2_historical_order(uuid,numeric,jsonb,text,boolean) TO service_role;