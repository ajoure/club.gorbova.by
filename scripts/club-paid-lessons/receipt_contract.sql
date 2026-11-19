-- All actors/receipts below are synthetic. Existing public Club product ID is not customer data.
CREATE TEMP TABLE receipt_checks(label text);
CREATE FUNCTION pg_temp.receipt_check(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'receipt_contract_failed:%',label; END IF;
 INSERT INTO receipt_checks VALUES(label);
END $$;
DO $test$
DECLARE u uuid:='00000000-0000-0000-0000-000000001000';p uuid:='00000000-0000-0000-0000-000000001001';
 h uuid:='00000000-0000-0000-0000-000000001002';s uuid:='00000000-0000-0000-0000-000000001003';
 hp uuid:='00000000-0000-0000-0000-000000001004';cp uuid:='00000000-0000-0000-0000-000000001005';
 ho uuid:='00000000-0000-0000-0000-000000001006';co uuid:='00000000-0000-0000-0000-000000001007';
 l uuid:='00000000-0000-0000-0000-000000001008';sib uuid:='00000000-0000-0000-0000-000000001009';
 t uuid:='00000000-0000-0000-0000-000000000003';r uuid:='00000000-0000-0000-0000-000000000010';
 par uuid:='00000000-0000-0000-0000-000000000008';club uuid:='11c9f1b8-0355-4753-bd74-40b42aa53616';
 k uuid:='00000000-0000-0000-0000-000000001010';m text:=to_char(now()-interval '2 months','YYYY-MM');
 before text;after text;pr jsonb;res jsonb;cmd text;restore text;pair text[];
BEGIN
 INSERT INTO auth.users VALUES(u);INSERT INTO public.profiles VALUES(p,u);
 INSERT INTO public.training_lessons VALUES(l,par,m,true,true),(sib,par,m,true,true);
 INSERT INTO public.orders_v2(id,user_id,profile_id,product_id,tariff_id,status,meta,final_price,currency) VALUES
 (ho,u,p,club,t,'paid','{"deal_month":"2000-07"}',250,'BYN'),(co,u,p,club,t,'paid','{"deal_month":"2000-06"}',250,'BYN');
 INSERT INTO public.subscriptions_v2(id,user_id,profile_id,product_id,tariff_id,status,access_start_at,access_end_at,order_id) VALUES
 (h,u,p,club,t,'expired',date_trunc('month',now())-interval '3 months',date_trunc('month',now())-interval '1 month',ho),
 (s,u,p,club,t,'active',now()-interval '20 days',date_trunc('second',now())+interval '20 days',co);
 INSERT INTO public.payments_v2(id,profile_id,user_id,order_id,status,currency,amount,refunded_amount,is_deleted,transaction_type,paid_at) VALUES
 (hp,p,u,ho,'succeeded','BYN',250,0,false,'Платеж',date_trunc('month',now())-interval '2 months'+interval '10 days'),
 (cp,p,u,co,'succeeded','BYN',250,0,false,'payment',now()-interval '20 days');
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.orders_v2 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payments_v2 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.subscriptions_v2 x))::text) INTO before;
 pr:=public.preview_club_paid_lesson_receipt(u,p,s,h,hp,cp,t,l,r,m,250);
 PERFORM pg_temp.receipt_check((pr->>'eligible')::boolean,'expired historical evidence plus separately paid active current accepted');
 PERFORM pg_temp.receipt_check(NOT public.has_month_purchase(u,t,m),'generic month never fabricated');
 res:=public.record_club_paid_lesson_receipt(k,u,p,s,h,hp,cp,t,l,r,m,250,(pr->>'expected_end')::timestamptz,pr->>'fingerprint','synthetic-owner-evidence','synthetic-operator');
 PERFORM pg_temp.receipt_check((res->>'created')::boolean,'new exact receipt claim created');
 PERFORM pg_temp.receipt_check(public.user_has_training_lesson_access(u,l),'exact server gate true');
 PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access(u,sib),'sibling denied');
 PERFORM pg_temp.receipt_check(NOT public.has_month_purchase(u,t,m),'whole month remains false after correction');
 PERFORM pg_temp.receipt_check((SELECT has_purchase FROM public.has_month_purchase_bulk(u,jsonb_build_array(jsonb_build_object('lesson_id',l::text||'::'||t,'tariff_id',t,'content_month',m)))),'real UI tuple opens exact lesson');
 res:=public.record_club_paid_lesson_receipt(k,u,p,s,h,hp,cp,t,l,r,m,250,(pr->>'expected_end')::timestamptz,pr->>'fingerprint','synthetic-owner-evidence','synthetic-operator');
 PERFORM pg_temp.receipt_check(NOT(res->>'created')::boolean AND (res->>'audit_rows_created')::int=0,'same request idempotent');
 BEGIN
 PERFORM public.record_club_paid_lesson_receipt('00000000-0000-0000-0000-000000001011',u,p,s,h,hp,cp,t,l,r,m,250,(pr->>'expected_end')::timestamptz,repeat('0',32),'synthetic-owner-evidence','synthetic-operator');
 RAISE EXCEPTION 'stale CAS was accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'paid_receipt_source_drift' THEN RAISE; END IF;
 END;PERFORM pg_temp.receipt_check(true,'stale CAS refused');
 res:=public.preview_club_paid_lesson_receipt(u,p,s,h,hp,cp,t,sib,r,m,250);
 BEGIN
 PERFORM public.record_club_paid_lesson_receipt('00000000-0000-0000-0000-000000001011',u,p,s,h,hp,cp,t,sib,r,m,250,(res->>'expected_end')::timestamptz,res->>'fingerprint','synthetic-owner-evidence','synthetic-operator');
 RAISE EXCEPTION 'double use was accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'paid_receipt_already_claimed' THEN RAISE; END IF;
 END;PERFORM pg_temp.receipt_check(true,'same receipt cannot authorize second lesson');
 -- Recheck all independent live prerequisites. Each mutation is restored exactly.
 FOR pair IN SELECT ARRAY[v.change,v.restore] FROM (VALUES
 (format('UPDATE public.payments_v2 SET refunded_amount=1 WHERE id=%L',cp),format('UPDATE public.payments_v2 SET refunded_amount=0 WHERE id=%L',cp)),
 (format('UPDATE public.payments_v2 SET status=''failed'' WHERE id=%L',cp),format('UPDATE public.payments_v2 SET status=''succeeded'' WHERE id=%L',cp)),
 (format('UPDATE public.payments_v2 SET refunded_amount=1 WHERE id=%L',hp),format('UPDATE public.payments_v2 SET refunded_amount=0 WHERE id=%L',hp)),
 (format('UPDATE public.payments_v2 SET transaction_type=''chargeback'' WHERE id=%L',hp),format('UPDATE public.payments_v2 SET transaction_type=''Платеж'' WHERE id=%L',hp)),
 (format('UPDATE public.payments_v2 SET is_deleted=true WHERE id=%L',hp),format('UPDATE public.payments_v2 SET is_deleted=false WHERE id=%L',hp)),
 (format('UPDATE public.payments_v2 SET order_id=%L WHERE id=%L',co,hp),format('UPDATE public.payments_v2 SET order_id=%L WHERE id=%L',ho,hp)),
 (format('UPDATE public.payments_v2 SET user_id=NULL WHERE id=%L',hp),format('UPDATE public.payments_v2 SET user_id=%L WHERE id=%L',u,hp)),
 (format('UPDATE public.orders_v2 SET final_price=251 WHERE id=%L',ho),format('UPDATE public.orders_v2 SET final_price=250 WHERE id=%L',ho)),
 (format('UPDATE public.orders_v2 SET is_deleted=true WHERE id=%L',ho),format('UPDATE public.orders_v2 SET is_deleted=false WHERE id=%L',ho)),
 (format('UPDATE public.subscriptions_v2 SET status=''expired'' WHERE id=%L',s),format('UPDATE public.subscriptions_v2 SET status=''active'' WHERE id=%L',s)),
 (format('UPDATE public.subscriptions_v2 SET access_end_at=now()-interval ''1 second'' WHERE id=%L',s),format('UPDATE public.subscriptions_v2 SET access_end_at=%L WHERE id=%L',pr->>'expected_end',s)),
 (format('UPDATE public.subscriptions_v2 SET tariff_id=''00000000-0000-0000-0000-000000000081'' WHERE id=%L',h),format('UPDATE public.subscriptions_v2 SET tariff_id=%L WHERE id=%L',t,h)),
 (format('UPDATE public.training_lessons SET content_month=''1999-01'' WHERE id=%L',l),format('UPDATE public.training_lessons SET content_month=%L WHERE id=%L',m,l)),
 (format('UPDATE public.training_lessons SET released=false WHERE id=%L',l),format('UPDATE public.training_lessons SET released=true WHERE id=%L',l)),
 (format('UPDATE private.club_paid_lesson_corrections SET revoked_at=now() WHERE correction_key=%L',k),format('UPDATE private.club_paid_lesson_corrections SET revoked_at=NULL WHERE correction_key=%L',k))
 )v(change,restore)
 LOOP
 EXECUTE pair[1];PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access(u,l),'live prerequisite mutation fails closed');EXECUTE pair[2];
 PERFORM pg_temp.receipt_check(public.user_has_training_lesson_access(u,l),'restored prerequisite opens exact lesson');
 END LOOP;
 -- Fresh preview hash cannot be used after a financial source mutation.
 UPDATE public.payments_v2 SET amount=251 WHERE id=hp;
 BEGIN
 PERFORM public.record_club_paid_lesson_receipt('00000000-0000-0000-0000-000000001011',u,p,s,h,hp,cp,t,l,r,m,250,(pr->>'expected_end')::timestamptz,pr->>'fingerprint','synthetic-owner-evidence','synthetic-operator');
 RAISE EXCEPTION 'changed source CAS accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'paid_receipt_source_drift' THEN RAISE;END IF;END;
 UPDATE public.payments_v2 SET amount=250 WHERE id=hp;
 PERFORM pg_temp.receipt_check(true,'actual receipt change after preview invalidates CAS');
 -- Duplicate direct historical/current lineage must not be chosen arbitrarily.
 INSERT INTO public.subscriptions_v2 SELECT '00000000-0000-0000-0000-000000001020',user_id,profile_id,product_id,tariff_id,status,access_start_at,access_end_at,order_id,is_trial FROM public.subscriptions_v2 WHERE id=h;
 PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access(u,l),'ambiguous historical lineage denied');DELETE FROM public.subscriptions_v2 WHERE id='00000000-0000-0000-0000-000000001020';
 INSERT INTO public.subscriptions_v2 SELECT '00000000-0000-0000-0000-000000001020',user_id,profile_id,product_id,tariff_id,status,access_start_at,access_end_at,order_id,is_trial FROM public.subscriptions_v2 WHERE id=s;
 PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access(u,l),'ambiguous current lineage denied');DELETE FROM public.subscriptions_v2 WHERE id='00000000-0000-0000-0000-000000001020';
 INSERT INTO public.payments_v2(id,status,transaction_type,reference_payment_id,is_deleted) VALUES('00000000-0000-0000-0000-000000001021','succeeded','chargeback',hp,false);
 PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access(u,l),'referenced chargeback invalidates receipt');DELETE FROM public.payments_v2 WHERE id='00000000-0000-0000-0000-000000001021';
 PERFORM pg_temp.receipt_check(NOT(public.preview_club_paid_lesson_receipt('00000000-0000-0000-0000-000000000080',p,s,h,hp,cp,t,l,r,m,250)->>'eligible')::boolean,'cross-user input denied');
 PERFORM pg_temp.receipt_check(NOT(public.preview_club_paid_lesson_receipt(u,p,s,h,hp,cp,t,l,r,'1999-01',250)->>'eligible')::boolean,'wrong requested month denied');
 PERFORM pg_temp.receipt_check(NOT public.user_has_training_lesson_access('00000000-0000-0000-0000-000000000080',l),'cross-user read denied');
 -- Current renewal can never move the frozen correction cap.
 UPDATE public.subscriptions_v2 SET access_end_at=access_end_at+interval '1 month' WHERE id=s;
 PERFORM pg_temp.receipt_check((SELECT valid_until=(pr->>'expected_end')::timestamptz FROM private.club_paid_lesson_corrections WHERE correction_key=k),'renewal cannot extend correction cap');
 UPDATE public.subscriptions_v2 SET access_end_at=(pr->>'expected_end')::timestamptz WHERE id=s;
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.orders_v2 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payments_v2 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.subscriptions_v2 x))::text) INTO after;
 PERFORM pg_temp.receipt_check(before=after,'orders payments subscriptions unchanged');
 PERFORM pg_temp.receipt_check((SELECT count(*)=1 FROM private.club_paid_lesson_correction_audit WHERE correction_key=k),'one immutable audit');
END $test$;
SELECT count(*) AS receipt_contract_assertions FROM receipt_checks;

-- Preserve the exact legacy NULL branch, including its original refund/net-money behavior.
DO $legacy$ DECLARE v jsonb; oldhash text; BEGIN
 SELECT md5(prosrc) INTO oldhash FROM pg_proc WHERE oid='private.club_paid_lesson_claim_valid_legacy(private.club_paid_lesson_corrections)'::regprocedure;
 PERFORM pg_temp.receipt_check(oldhash='c930d75b027f5c2b74f16aa021bce680','legacy validator body byte-identical');
 INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000002000');
 INSERT INTO public.profiles VALUES('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000002000');
 INSERT INTO public.subscriptions_v2(id,user_id,profile_id,product_id,tariff_id,status,access_start_at,access_end_at) VALUES('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000002000','00000000-0000-0000-0000-000000002001','11c9f1b8-0355-4753-bd74-40b42aa53616','00000000-0000-0000-0000-000000000003','active',now()-interval '4 months',now()+interval '1 month');
 INSERT INTO public.payments_v2(id,profile_id,status,currency,amount,refunded_amount,is_deleted) VALUES('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000002001','succeeded','BYN',800,50,false);
 v:=public.record_club_paid_lesson_correction('00000000-0000-0000-0000-000000002004','00000000-0000-0000-0000-000000002000','00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000001008',to_char(now()-interval '2 months','YYYY-MM'),750,now()+interval '1 month','synthetic-legacy-agreement','synthetic-operator');
 PERFORM pg_temp.receipt_check((v->>'active')::boolean,'old12param writer and NULL branch net-refund semantics retained');
END $legacy$;
SELECT count(*) AS total_receipt_contract_assertions FROM receipt_checks;

DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('preview_club_paid_lesson_receipt','record_club_paid_lesson_receipt') LOOP
 PERFORM pg_temp.receipt_check(NOT has_function_privilege('anon',f.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE') AND has_function_privilege('service_role',f.oid,'EXECUTE'),'new RPC service-only ACL');
 END LOOP;
END $acl$;
