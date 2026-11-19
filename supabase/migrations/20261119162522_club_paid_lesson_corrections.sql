-- Exact-lesson receipt lineage; no payment/order/subscription mutation or whole-month grant.
BEGIN;
DO $preflight$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.club_paid_lesson_claim_valid(private.club_paid_lesson_corrections)'::regprocedure) IS DISTINCT FROM 'c930d75b027f5c2b74f16aa021bce680'
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='club_paid_lesson_corrections' AND column_name='historical_subscription_id')
 THEN RAISE EXCEPTION 'paid_receipt_baseline_drift'; END IF;
END $preflight$;
ALTER TABLE private.club_paid_lesson_corrections
 ADD COLUMN historical_subscription_id uuid REFERENCES public.subscriptions_v2(id),
 ADD COLUMN historical_order_id uuid REFERENCES public.orders_v2(id),
 ADD COLUMN current_payment_id uuid REFERENCES public.payments_v2(id),
 ADD COLUMN current_order_id uuid REFERENCES public.orders_v2(id),
 ADD COLUMN receipt_lineage_hash text,
 ADD CONSTRAINT paid_receipt_complete_lineage CHECK(
 (historical_subscription_id IS NULL AND historical_order_id IS NULL AND current_payment_id IS NULL AND current_order_id IS NULL AND receipt_lineage_hash IS NULL)
 OR (historical_subscription_id IS NOT NULL AND historical_order_id IS NOT NULL AND current_payment_id IS NOT NULL AND current_order_id IS NOT NULL AND receipt_lineage_hash IS NOT NULL AND receipt_lineage_hash ~ '^[0-9a-f]{32}$'));
CREATE UNIQUE INDEX club_paid_receipt_single_active ON private.club_paid_lesson_corrections(source_payment_id)
 WHERE historical_subscription_id IS NOT NULL AND revoked_at IS NULL;
DO $preserve$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('private.club_paid_lesson_claim_valid(private.club_paid_lesson_corrections)'::regprocedure) INTO d;
 EXECUTE replace(d,'private.club_paid_lesson_claim_valid(', 'private.club_paid_lesson_claim_valid_legacy(');
END $preserve$;
REVOKE ALL ON FUNCTION private.club_paid_lesson_claim_valid_legacy(private.club_paid_lesson_corrections) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.club_receipt_payment_kind(t text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(btrim(t) IN('payment','Платеж','Платёж'),false)
$$;
CREATE FUNCTION private.club_paid_receipt_snapshot(c private.club_paid_lesson_corrections)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
 'claim',to_jsonb(c)-ARRAY['correction_key','receipt_lineage_hash','evidence_ref','operator_ref','created_at','revoked_at'],
 'subscriptions',(SELECT jsonb_agg(jsonb_build_array(s.id,s.user_id,s.profile_id,s.product_id,s.tariff_id,s.order_id,s.status,s.is_trial,s.access_start_at,s.access_end_at) ORDER BY s.id) FROM public.subscriptions_v2 s WHERE s.id IN(c.source_subscription_id,c.historical_subscription_id)),
 'payments',(SELECT jsonb_agg(jsonb_build_array(p.id,p.user_id,p.profile_id,p.order_id,p.status,p.currency,p.amount,p.refunded_amount,p.transaction_type,p.is_deleted,p.paid_at) ORDER BY p.id) FROM public.payments_v2 p WHERE p.id IN(c.source_payment_id,c.current_payment_id)),
 'orders',(SELECT jsonb_agg(jsonb_build_array(o.id,o.user_id,o.profile_id,o.product_id,o.tariff_id,o.status,o.final_price,o.currency,o.is_trial,o.is_deleted) ORDER BY o.id) FROM public.orders_v2 o WHERE o.id IN(c.historical_order_id,c.current_order_id)),
 'lesson',(SELECT jsonb_build_array(l.id,l.module_id,l.content_month,l.is_active,public.training_release_guard(l.id)) FROM public.training_lessons l WHERE l.id=c.lesson_id),
 'rule',(SELECT jsonb_build_array(r.id,r.product_id,r.tariff_id,r.grant_target_type,r.target_ref,r.is_active,r.conditions) FROM public.access_rules r WHERE r.id=c.rule_id))
$$;
CREATE FUNCTION private.club_paid_receipt_valid(c private.club_paid_lesson_corrections)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 WITH RECURSIVE chain AS(
 SELECT m.id,m.parent_module_id,m.product_id,m.is_active,ARRAY[m.id] seen FROM public.training_modules m JOIN public.training_lessons l ON l.module_id=m.id WHERE l.id=c.lesson_id
 UNION ALL SELECT m.id,m.parent_module_id,m.product_id,m.is_active,a.seen||m.id FROM public.training_modules m JOIN chain a ON m.id=a.parent_module_id WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<12)
 SELECT coalesce(c.revoked_at IS NULL AND c.valid_until>now() AND c.receipt_lineage_hash ~ '^[0-9a-f]{32}$' AND EXISTS(
 SELECT 1 FROM public.profiles p
 JOIN public.subscriptions_v2 s ON s.id=c.source_subscription_id
 JOIN public.subscriptions_v2 h ON h.id=c.historical_subscription_id
 JOIN public.orders_v2 ho ON ho.id=c.historical_order_id
 JOIN public.orders_v2 co ON co.id=c.current_order_id
 JOIN public.payments_v2 hp ON hp.id=c.source_payment_id
 JOIN public.payments_v2 cp ON cp.id=c.current_payment_id
 JOIN public.training_lessons l ON l.id=c.lesson_id
 JOIN public.access_rules r ON r.id=c.rule_id
 WHERE p.id=c.profile_id AND p.user_id=c.user_id
 AND s.user_id=p.user_id AND s.profile_id=p.id AND h.user_id=p.user_id AND h.profile_id=p.id
 AND s.id<>h.id AND hp.id<>cp.id
 AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid AND h.product_id=s.product_id
 AND s.tariff_id=c.tariff_id AND h.tariff_id=c.tariff_id
 AND s.status::text='active' AND NOT coalesce(s.is_trial,false) AND s.access_start_at<=now() AND s.access_end_at>now()
 AND h.status::text='expired' AND NOT coalesce(h.is_trial,false) AND h.access_end_at<=now()
 AND h.access_start_at<=hp.paid_at AND hp.paid_at<h.access_end_at
 AND h.access_start_at<(c.deal_month||'-01')::date+interval '1 month' AND h.access_end_at>(c.deal_month||'-01')::date
 AND to_char(hp.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')=c.deal_month
 AND s.access_start_at<=cp.paid_at AND cp.paid_at<s.access_end_at AND cp.paid_at<=now()
 AND hp.order_id=h.order_id AND hp.order_id=ho.id AND cp.order_id=s.order_id AND cp.order_id=co.id
 AND ho.user_id=p.user_id AND ho.profile_id=p.id AND co.user_id=p.user_id AND co.profile_id=p.id
 AND ho.product_id=s.product_id AND co.product_id=s.product_id AND ho.tariff_id=c.tariff_id AND co.tariff_id=c.tariff_id
 AND ho.status::text='paid' AND co.status::text='paid' AND NOT coalesce(ho.is_deleted,false) AND NOT coalesce(co.is_deleted,false)
 AND NOT coalesce(ho.is_trial,false) AND NOT coalesce(co.is_trial,false)
 AND ho.currency='BYN' AND co.currency='BYN' AND ho.final_price=c.agreement_amount AND co.final_price>0
 AND hp.profile_id=p.id AND cp.profile_id=p.id AND hp.user_id=p.user_id AND cp.user_id=p.user_id
 AND hp.status::text='succeeded' AND cp.status::text='succeeded' AND hp.currency='BYN' AND cp.currency='BYN'
 AND private.club_receipt_payment_kind(hp.transaction_type) AND private.club_receipt_payment_kind(cp.transaction_type)
 AND NOT coalesce(hp.is_deleted,false) AND NOT coalesce(cp.is_deleted,false)
 AND coalesce(hp.refunded_amount,0)=0 AND coalesce(cp.refunded_amount,0)=0
 AND hp.amount-coalesce(hp.refunded_amount,0)>=c.agreement_amount AND cp.amount-coalesce(cp.refunded_amount,0)>=co.final_price
 AND NOT EXISTS(SELECT 1 FROM public.payments_v2 rev WHERE rev.reference_payment_id IN(hp.id,cp.id) AND NOT coalesce(rev.is_deleted,false)
   AND lower(rev.status::text) IN('succeeded','refunded','chargeback') AND (lower(rev.transaction_type) IN('refund','возврат','chargeback','чарджбэк') OR coalesce(rev.refunded_amount,0)>0))
 AND (SELECT count(*) FROM public.subscriptions_v2 x WHERE x.order_id=h.order_id AND x.user_id=p.user_id AND x.profile_id=p.id AND x.product_id=s.product_id AND x.tariff_id=c.tariff_id AND x.status::text='expired' AND x.access_start_at<=hp.paid_at AND x.access_end_at>hp.paid_at)=1
 AND (SELECT count(*) FROM public.subscriptions_v2 x WHERE x.order_id=s.order_id AND x.user_id=p.user_id AND x.profile_id=p.id AND x.product_id=s.product_id AND x.tariff_id=c.tariff_id AND x.status::text='active' AND x.access_start_at<=now() AND x.access_end_at>now())=1
 AND l.is_active AND left(l.content_month::text,7)=c.deal_month AND public.training_release_guard(l.id)
 AND r.is_active AND r.grant_target_type='training_content' AND r.product_id=s.product_id AND r.tariff_id=s.tariff_id
 AND r.target_ref IN(SELECT id::text FROM chain WHERE parent_module_id IS NULL)
 AND EXISTS(SELECT 1 FROM chain WHERE parent_module_id IS NULL AND product_id=s.product_id)
 AND NOT EXISTS(SELECT 1 FROM chain WHERE is_active IS NOT TRUE)
 AND private.club_month_rule_allows_lesson(r.conditions,l.id,l.module_id)
 AND (SELECT count(*) FROM public.access_rules ar WHERE ar.is_active AND ar.product_id=s.product_id AND ar.tariff_id=s.tariff_id AND ar.grant_target_type='training_content' AND ar.target_ref IN(SELECT id::text FROM chain WHERE parent_module_id IS NULL) AND private.club_month_rule_allows_lesson(ar.conditions,l.id,l.module_id))=1
 ),false)
$$;
CREATE OR REPLACE FUNCTION private.club_paid_lesson_claim_valid(c private.club_paid_lesson_corrections)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN c.historical_subscription_id IS NULL AND c.historical_order_id IS NULL AND c.current_payment_id IS NULL AND c.current_order_id IS NULL AND c.receipt_lineage_hash IS NULL
 THEN private.club_paid_lesson_claim_valid_legacy(c) ELSE private.club_paid_receipt_valid(c) END
$$;

CREATE FUNCTION private.club_paid_receipt_candidate(u uuid,p uuid,s uuid,h uuid,hp uuid,cp uuid,t uuid,l uuid,r uuid,m text,a numeric)
RETURNS private.club_paid_lesson_corrections LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_populate_record(NULL::private.club_paid_lesson_corrections,jsonb_build_object('user_id',u,'profile_id',p,'source_subscription_id',s,'source_payment_id',hp,'tariff_id',t,'lesson_id',l,'rule_id',r,'deal_month',m,'agreement_amount',a,'valid_until',cs.access_end_at,'historical_subscription_id',h,'historical_order_id',hs.order_id,'current_payment_id',cp,'current_order_id',cs.order_id)) FROM public.subscriptions_v2 cs CROSS JOIN public.subscriptions_v2 hs WHERE cs.id=s AND hs.id=h
$$;
CREATE FUNCTION public.preview_club_paid_lesson_receipt(u uuid,p uuid,s uuid,h uuid,hp uuid,cp uuid,t uuid,l uuid,r uuid,m text,a numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.club_paid_lesson_corrections; BEGIN
 IF m IS NULL OR m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR a IS NULL OR a<=0 THEN RAISE EXCEPTION 'invalid_paid_receipt_input'; END IF;
 c:=private.club_paid_receipt_candidate(u,p,s,h,hp,cp,t,l,r,m,a);
 c.receipt_lineage_hash:=md5(private.club_paid_receipt_snapshot(c)::text);
 RETURN jsonb_build_object('eligible',private.club_paid_receipt_valid(c),'expected_end',c.valid_until,'fingerprint',c.receipt_lineage_hash);
END $$;
CREATE FUNCTION public.record_club_paid_lesson_receipt(k uuid,u uuid,p uuid,s uuid,h uuid,hp uuid,cp uuid,t uuid,l uuid,r uuid,m text,a numeric,expected_end timestamptz,expected_hash text,evidence text,operator_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.club_paid_lesson_corrections; prior private.club_paid_lesson_corrections; snapshot jsonb; BEGIN
 IF k IS NULL OR m IS NULL OR m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR a IS NULL OR a<=0 OR expected_end IS NULL OR expected_end<=now() OR expected_hash IS NULL OR expected_hash !~ '^[0-9a-f]{32}$' OR evidence IS NULL OR length(evidence) NOT BETWEEN 16 AND 256 OR operator_ref IS NULL OR length(operator_ref) NOT BETWEEN 1 AND 96 THEN RAISE EXCEPTION 'invalid_paid_receipt_input'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(hp::text,1));
 SELECT * INTO prior FROM private.club_paid_lesson_corrections WHERE correction_key=k;
 IF FOUND THEN
 IF (prior.user_id,prior.profile_id,prior.source_subscription_id,prior.historical_subscription_id,prior.source_payment_id,prior.current_payment_id,prior.tariff_id,prior.lesson_id,prior.rule_id,prior.deal_month,prior.agreement_amount,prior.valid_until,prior.receipt_lineage_hash,prior.evidence_ref,prior.operator_ref) IS DISTINCT FROM (u,p,s,h,hp,cp,t,l,r,m,a,expected_end,expected_hash,evidence,operator_ref) THEN RAISE EXCEPTION 'paid_receipt_idempotency_conflict'; END IF;
 RETURN jsonb_build_object('created',false,'correction_key',k,'active',private.club_paid_lesson_claim_valid(prior),'audit_rows_created',0);
 END IF;
 PERFORM 1 FROM public.subscriptions_v2 WHERE id IN(s,h) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.payments_v2 WHERE id IN(hp,cp) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.orders_v2 WHERE id IN(SELECT order_id FROM public.subscriptions_v2 WHERE id IN(s,h)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.profiles WHERE id=p FOR SHARE;
 PERFORM 1 FROM public.access_rules WHERE id=r FOR SHARE;
 PERFORM 1 FROM public.training_lessons WHERE id=l FOR SHARE;
 c:=private.club_paid_receipt_candidate(u,p,s,h,hp,cp,t,l,r,m,a);
 snapshot:=private.club_paid_receipt_snapshot(c); c.receipt_lineage_hash:=md5(snapshot::text);
 IF c.valid_until IS DISTINCT FROM expected_end OR c.receipt_lineage_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'paid_receipt_source_drift'; END IF;
 c.correction_key:=k;c.evidence_ref:=evidence;c.operator_ref:=operator_ref;c.created_at:=statement_timestamp();
 IF NOT private.club_paid_receipt_valid(c) THEN RAISE EXCEPTION 'paid_receipt_evidence_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM private.club_paid_lesson_corrections x WHERE x.source_payment_id=hp AND (x.revoked_at IS NULL OR x.historical_subscription_id IS NOT NULL)) THEN RAISE EXCEPTION 'paid_receipt_already_claimed'; END IF;
 INSERT INTO private.club_paid_lesson_corrections SELECT(c).*;
 INSERT INTO private.club_paid_lesson_correction_audit(correction_key,operator_ref,evidence_ref,snapshot) VALUES(k,operator_ref,evidence,jsonb_build_object('correction',to_jsonb(c),'receipt_lineage',snapshot));
 RETURN jsonb_build_object('created',true,'correction_key',k,'active',true,'audit_rows_created',1);
END $$;
DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('club_receipt_payment_kind','club_paid_receipt_snapshot','club_paid_receipt_valid','club_paid_receipt_candidate','club_paid_lesson_claim_valid_legacy') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature); IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec_hdjgkjceownmmnrqqtuz') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM sandbox_exec_hdjgkjceownmmnrqqtuz',f.signature); END IF; END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('preview_club_paid_lesson_receipt','record_club_paid_lesson_receipt') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec_hdjgkjceownmmnrqqtuz') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sandbox_exec_hdjgkjceownmmnrqqtuz',f.signature); END IF;
 END LOOP;
END $acl$;
COMMIT;
