-- Fixed owner-approved historical batches only. No sandbox grants, arbitrary SQL or Auth mutations.
CREATE OR REPLACE FUNCTION public.admin_import_historical_cb_17_18(_payload jsonb, _mode text DEFAULT 'dry-run')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $managed$
DECLARE
 do_execute boolean := _mode <> 'dry-run';
 payload jsonb := _payload;
 batch_id text := 'hist-cb17-18-20260911-v1';
 item jsonb; p record; existing jsonb; prospective jsonb := '[]'::jsonb;
 new_ids uuid[] := '{}'::uuid[]; covered integer:=0; changed integer; new_count integer;
 is_module boolean; product_name text; product_code_value text; tariff_name text;
 operation_result jsonb; rollback_message text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF _mode IS NULL OR _mode NOT IN ('dry-run','rollback','execute') OR _payload IS NULL THEN RAISE EXCEPTION 'Explicit supported operation mode and payload required'; END IF;
 IF encode(sha256(convert_to(_payload::text,'UTF8')),'hex') <> ALL(ARRAY['95a5d4083461982dede2bb14cda039fd1b46aeffad35667e23e88a1771ff0d67','14ca893d5a15f1942b61909bf457f601fc1309983327c0a1a570d295fe05df8b','0b2d32818dfd075db6caa6954dc23498d5df41395fc47ac2c59d1ab8054247dc','069a8da0e71b17024b03fccb2a1d76b87305e9af5f83542a20eb23d437a0397b','c2f46ea96af8d7cc3d2c5f06e8e962462ce9926faf085de856522c7151e0cae8','d19f107f1ee03873fb5653f0217b66c9280e01031c9d407aab48e78efe341fc4','9c096ff139b0f5e7c03f03ae10bb4de459fa3ead78d32f684660c2575f30d801','ec8f79c88efda06baee2401e42bf453c18a273dae78422d9b9d7422e580964ee','669cce6876d6972993e44cf04913af4e4dbedbf46e03b4a0370d12efe3c48907','6135cccd6b6e6f579eacac9f22e50b94b7a17e0d16c181e72bb619c9eafd8a03','e10867119a57dbfd98c003f5cbaf9cc64606d8d6532514d3f97c3b151bcff1da','3d966654206b89c6ec8b98274602e2d2d811edd4a7e4025f95c736c7bdfcf65f','3395767cf3f66888ee26a9322136f13237e9980d533cba32f78483d83d7564f0','379786656ba8c527d59ad7fcb5898b6830ac9c6b4108067e26e3f2a0f0a6ab60','4d6b35f1b6ed72178b1151bd3aab6e246ffe1403b016a8c70b0f498475f3df75']::text[])
 THEN RAISE EXCEPTION 'Payload is not one of the owner-approved fixed batches'; END IF;
 BEGIN
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)<1 OR jsonb_array_length(payload)>20
 THEN RAISE EXCEPTION 'Historical batch must contain 1..20 reviewed facts'; END IF;
 PERFORM pg_advisory_xact_lock(71171800);
 FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
  IF item->>'history_only'<>'true' OR item->>'owner_confirmed_paid'<>'true'
    OR item->>'create_payment'<>'false' OR item->>'grant_access'<>'false'
    OR item->>'cohort' NOT IN ('17','18')
    OR item->>'kind' NOT IN ('module_only_standalone','base_tariff_purchase')
    OR item->>'idempotency_key' NOT LIKE batch_id||':%'
  THEN RAISE EXCEPTION 'Unapproved historical fact'; END IF;
  is_module:=item->>'kind'='module_only_standalone';
  SELECT * INTO p FROM public.profiles WHERE id=(item->>'profile_id')::uuid FOR UPDATE;
  IF p.id IS NULL OR p.merged_to_profile_id IS NOT NULL OR p.status='banned'
    OR p.user_id IS DISTINCT FROM (item->>'user_id')::uuid
  THEN RAISE EXCEPTION 'Historical target identity changed'; END IF;
  IF is_module THEN
   IF item->>'product_id' NOT IN ('64d9f812-617c-41a8-b3dc-bb113156d6f3','ea98d043-e852-443f-8807-6e77de6a5e1f',
     '99f1f156-f384-417e-bdf8-9203eb3c9d42','d7effaf4-9be0-4ce2-971b-e02fe2a85a9a',
     'abee24cd-5c8b-4111-a6cb-7dee7acf168c','9187db54-8f57-42eb-bbcb-d7103d2459a9',
     '064dd768-de8b-40db-89bc-f8d4a7e442ba','f833c846-a78d-4096-9dac-b8417d588371')
     OR item->>'tariff_id' IS NOT NULL OR item->>'flow_id' IS NOT NULL
   THEN RAISE EXCEPTION 'Historical module catalog changed'; END IF;
  ELSE
   IF item->>'product_id'<>'7101ed3c-7839-4a74-ad95-aa0660369b22'
     OR item->>'tariff_id' NOT IN ('adbe94e8-171d-4b49-8338-66c554bb1f0b','543940b1-99da-47f3-accc-671ad5b11afe','9bc81736-e7e5-48db-9925-b866427a98e1')
     OR (item->>'cohort'='17' AND item->>'flow_id' IS NOT NULL)
     OR (item->>'cohort'='18' AND item->>'flow_id' IS DISTINCT FROM '2d635c0d-37d5-4600-a86f-5c34297f7aab')
   THEN RAISE EXCEPTION 'Historical course catalog changed'; END IF;
  END IF;
  SELECT to_jsonb(o) INTO existing FROM public.orders_v2 o WHERE id=(item->>'id')::uuid;
  IF existing IS NOT NULL THEN
   IF existing->>'profile_id' IS DISTINCT FROM item->>'profile_id'
      OR existing->>'product_id' IS DISTINCT FROM item->>'product_id'
      OR existing->>'tariff_id' IS DISTINCT FROM item->>'tariff_id'
      OR existing->>'status' IS DISTINCT FROM 'paid' OR (existing->>'is_deleted')::boolean IS TRUE
      OR existing->'meta'->>'historical_idempotency_key' IS DISTINCT FROM item->>'idempotency_key'
   THEN RAISE EXCEPTION 'Historical deterministic ID collision'; END IF;
   covered:=covered+1; CONTINUE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders_v2 o WHERE status='paid' AND is_deleted IS NOT TRUE
    AND (profile_id=p.id OR (p.user_id IS NOT NULL AND user_id=p.user_id))
    AND ((is_module AND (product_id=(item->>'product_id')::uuid
      OR (purchase_snapshot->>'historical_purchase_type' IN ('module_only_standalone','module_child_purchase','base_tariff_purchase')
          AND purchase_snapshot->'module_list_mapped' @> jsonb_build_array(item->>'product_id'))))
      OR (NOT is_module AND product_id=(item->>'product_id')::uuid AND tariff_id=(item->>'tariff_id')::uuid
          AND coalesce(purchase_snapshot->>'historical_purchase_type','') NOT IN ('module_only_standalone','module_child_purchase'))))
  THEN covered:=covered+1; CONTINUE; END IF;
  prospective:=prospective||jsonb_build_array(item);
 END LOOP;
 new_count:=jsonb_array_length(prospective);
 RAISE NOTICE 'Historical batch total %, missing %, already covered %',jsonb_array_length(payload),new_count,covered;
 IF NOT do_execute THEN RETURN jsonb_build_object('total',jsonb_array_length(payload),'missing',new_count,'already_covered',covered,'inserted',0); END IF;
 IF new_count=0 THEN RETURN jsonb_build_object('total',jsonb_array_length(payload),'missing',0,'already_covered',covered,'inserted',0,'replay',true); END IF;
 IF covered<>0 THEN RAISE EXCEPTION 'Partial coverage changed: regenerate reviewed batch before execute'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(prospective) LOOP
  is_module:=item->>'kind'='module_only_standalone';
  SELECT name,code INTO product_name,product_code_value FROM public.products_v2 WHERE id=(item->>'product_id')::uuid;
  IF product_name IS NULL THEN RAISE EXCEPTION 'Historical product missing'; END IF;
  tariff_name:=NULL;
  IF NOT is_module THEN
   SELECT name INTO tariff_name FROM public.tariffs WHERE id=(item->>'tariff_id')::uuid AND product_id=(item->>'product_id')::uuid;
   IF tariff_name IS NULL THEN RAISE EXCEPTION 'Historical tariff missing'; END IF;
  END IF;
  INSERT INTO public.orders_v2(id,order_number,profile_id,user_id,product_id,tariff_id,flow_id,
    status,is_deleted,is_trial,base_price,final_price,paid_amount,currency,provider,reconcile_source,
    deal_date,pipeline_id,pipeline_stage_id,meta,purchase_snapshot)
  VALUES((item->>'id')::uuid,'HIST-'||(item->>'id'),(item->>'profile_id')::uuid,(item->>'user_id')::uuid,
    (item->>'product_id')::uuid,(item->>'tariff_id')::uuid,(item->>'flow_id')::uuid,
    'paid',false,false,0,0,0,'BYN',NULL,'owner_confirmed_historical',NULL,NULL,NULL,
    jsonb_build_object('history_only',true,'owner_confirmed_paid',true,'historical_batch_id',batch_id,
      'historical_idempotency_key',item->>'idempotency_key','source_spreadsheet_id','1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8',
      'source_refs',item->'refs','source_cohort',(item->>'cohort')::int,'source_amount_unknown',true,'source_purchase_date_unknown',true),
    jsonb_build_object('product_id',item->>'product_id','product_name',product_name,'product_code',product_code_value,
      'tariff_id',item->'tariff_id','tariff_name',tariff_name,'flow_id',item->'flow_id',
      'flow_assignment_mode',CASE WHEN item->>'flow_id' IS NULL THEN 'no_flow' ELSE 'from_sheet' END,
      'reconcile_source','owner_confirmed_historical','import_source','owner_confirmed_sheet_17_18',
      'history_only',true,'owner_confirmed_paid',true,'historical_purchase_type',item->>'kind',
      'display_purchase_name',product_name,'module_list_mapped',CASE WHEN is_module THEN jsonb_build_array(item->>'product_id') ELSE '[]'::jsonb END,
      'source_refs',item->'refs','source_cohort',(item->>'cohort')::int));
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Unexpected historical insert count'; END IF;
  new_ids:=array_append(new_ids,(item->>'id')::uuid);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id=ANY(new_ids))
   OR EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE order_id=ANY(new_ids))
   OR EXISTS(SELECT 1 FROM public.entitlements WHERE order_id=ANY(new_ids))
   OR EXISTS(SELECT 1 FROM public.entitlement_sources WHERE order_id=ANY(new_ids))
   OR EXISTS(SELECT 1 FROM public.access_grant_ledger WHERE order_id=ANY(new_ids) OR source_order_id=ANY(new_ids))
   OR EXISTS(SELECT 1 FROM public.referral_balance_transactions WHERE source_id::text=ANY(new_ids::text[]))
   OR EXISTS(SELECT 1 FROM public.orders_v2 WHERE id=ANY(new_ids) AND (paid_amount<>0 OR base_price<>0 OR final_price<>0
     OR meta->>'deal_month' IS NOT NULL OR status<>'paid' OR is_deleted IS TRUE OR pipeline_id IS NOT NULL OR pipeline_stage_id IS NOT NULL))
 THEN RAISE EXCEPTION 'Unexpected historical payment/access/financial side effect'; END IF;
 INSERT INTO public.audit_logs(action,actor_type,actor_label,meta)
 VALUES('HISTORICAL_PURCHASES_IMPORTED','system','Owner-approved paid history reconciliation',
   jsonb_build_object('batch_id',batch_id,'order_ids',to_jsonb(new_ids),'inserted',new_count,
     'payments_created',0,'access_granted',0,'source','owner_confirmed_sheet_17_18'));
 operation_result := jsonb_build_object('total',jsonb_array_length(payload),'missing',new_count,'already_covered',covered,'inserted',new_count);
 IF _mode='rollback' THEN RAISE EXCEPTION USING ERRCODE='ZHB01',MESSAGE=operation_result::text; END IF;
 RETURN operation_result;
 EXCEPTION WHEN SQLSTATE 'ZHB01' THEN
  GET STACKED DIAGNOSTICS rollback_message=MESSAGE_TEXT;
  RETURN rollback_message::jsonb || jsonb_build_object('rolled_back',true);
 END;
END;
$managed$;
REVOKE ALL ON FUNCTION public.admin_import_historical_cb_17_18(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_import_historical_cb_17_18(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_repair_historical_cb_scope(_payload jsonb, _mode text DEFAULT 'dry-run')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $managed$
DECLARE
 do_execute boolean := _mode <> 'dry-run';
 payload jsonb := _payload;
 item jsonb; e public.entitlements%ROWTYPE; o public.orders_v2%ROWTYPE;
 before_row jsonb; after_row jsonb; patch jsonb; changed integer:=0;
 batch constant text:='hist-cb17-18-20260911-v1';
 operation_result jsonb; rollback_message text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF _mode IS NULL OR _mode NOT IN ('dry-run','rollback','execute') OR _payload IS NULL THEN RAISE EXCEPTION 'Explicit supported operation mode and payload required'; END IF;
 IF encode(sha256(convert_to(_payload::text,'UTF8')),'hex') <> ALL(ARRAY['ecaef38c9ccca2c98143f9db410fe8f8eec09534654211586946329c6f0c2f1e']::text[])
 THEN RAISE EXCEPTION 'Payload is not one of the owner-approved fixed batches'; END IF;
 BEGIN
 IF jsonb_array_length(payload)<1 OR jsonb_array_length(payload)>20 THEN RAISE EXCEPTION 'Invalid scope repair batch'; END IF;
 PERFORM pg_advisory_xact_lock(71171801);
 FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
  SELECT * INTO e FROM public.entitlements WHERE id=(item->>'entitlement_id')::uuid FOR UPDATE;
  SELECT * INTO o FROM public.orders_v2 WHERE id=(item->>'order_id')::uuid FOR UPDATE;
  IF e.id IS NULL OR o.id IS NULL OR e.user_id IS DISTINCT FROM(item->>'user_id')::uuid
   OR e.product_id IS DISTINCT FROM '7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid
   OR e.status IS DISTINCT FROM 'active' OR e.expires_at IS NULL OR e.expires_at<=now()
   OR e.meta->>'source_rule_id' IS DISTINCT FROM '1b497fba-031a-4318-8d9f-2530f1bac116'
   OR coalesce(e.meta->>'manual_override','false') IN('true','1')
   OR coalesce(e.meta->>'admin_override','false') IN('true','1')
   OR o.user_id IS DISTINCT FROM e.user_id OR o.profile_id IS DISTINCT FROM(item->>'profile_id')::uuid
   OR o.status::text IS DISTINCT FROM 'paid' OR o.is_deleted IS TRUE
   OR o.product_id IS DISTINCT FROM e.product_id OR o.tariff_id IS NULL
   OR o.meta->>'historical_batch_id' IS DISTINCT FROM batch
   OR o.meta->>'owner_confirmed_paid' IS DISTINCT FROM 'true'
   OR o.purchase_snapshot->>'historical_purchase_type' IS DISTINCT FROM 'base_tariff_purchase'
  THEN RAISE EXCEPTION 'Course repair identity, lineage or prior purchase changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=o.profile_id AND user_id=e.user_id
    AND merged_to_profile_id IS NULL AND status<>'banned')
  THEN RAISE EXCEPTION 'Course repair profile changed'; END IF;
  IF e.meta->>'historical_scope_repair_batch'=batch AND e.meta->>'prior_purchase_order_id'=o.id::text
    AND e.meta->>'scope_resolution_mode'='full_tariff_scope' THEN CONTINUE; END IF;
  IF e.meta->>'scope_resolution_mode' IS DISTINCT FROM 'module_scope_only'
  THEN RAISE EXCEPTION 'Scope changed since review'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.subscriptions_v2 s JOIN public.orders_v2 paid ON paid.id=s.order_id
   WHERE s.user_id=e.user_id AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
     AND s.tariff_id='7c748940-dcad-4c7c-a92e-76a2344622d3' AND s.status::text IN('active','past_due','canceled')
     AND s.is_trial IS NOT TRUE AND s.access_start_at<=now() AND s.access_end_at>now()
     AND paid.status::text='paid' AND paid.is_deleted IS NOT TRUE AND paid.is_trial IS NOT TRUE
     AND paid.tariff_id=s.tariff_id
     AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(coalesce(paid.meta,'{}')) flag WHERE flag.key IN('test','sandbox','gift') AND lower(flag.value) IN('true','1'))
     AND (SELECT coalesce(sum(amount-coalesce(refunded_amount,0)),0) FROM public.payments_v2 payment
       WHERE payment.order_id=paid.id AND payment.status='succeeded' AND payment.currency='BYN')>=250)
  THEN RAISE EXCEPTION 'No current paid Business 250 window'; END IF;
  changed:=changed+1;
  IF NOT do_execute THEN CONTINUE; END IF;
  before_row:=to_jsonb(e);
  patch:=e.meta||jsonb_build_object('scope_resolution_mode','full_tariff_scope','prior_purchase_match_type','direct',
    'prior_purchase_order_id',o.id,'historical_purchase_type','base_tariff_purchase','historical_tariff_id',o.tariff_id,
    'historical_module_product_ids','[]'::jsonb,'historical_scope_repair_batch',batch);
  UPDATE public.entitlements SET meta=patch WHERE id=e.id;
  SELECT to_jsonb(x) INTO after_row FROM public.entitlements x WHERE id=e.id;
  IF (after_row-ARRAY['meta','updated_at']) IS DISTINCT FROM(before_row-ARRAY['meta','updated_at'])
   OR after_row->'meta' IS DISTINCT FROM patch THEN RAISE EXCEPTION 'Unexpected scope repair side effect'; END IF;
  INSERT INTO public.audit_logs(action,actor_type,actor_label,target_user_id,meta)
   VALUES('HISTORICAL_COURSE_SCOPE_REPAIRED','system','Owner-approved historical purchase reconciliation',e.user_id,
    jsonb_build_object('batch_id',batch,'entitlement_id',e.id,'prior_purchase_order_id',o.id,
      'before',before_row,'after',after_row,'expires_at_changed',false));
 END LOOP;
 RAISE NOTICE 'Historical course scope repair count % (execute=%)',changed,do_execute;
 operation_result := jsonb_build_object('total',jsonb_array_length(payload),'changed',changed,'executed',do_execute);
 IF _mode='rollback' THEN RAISE EXCEPTION USING ERRCODE='ZHB01',MESSAGE=operation_result::text; END IF;
 RETURN operation_result;
 EXCEPTION WHEN SQLSTATE 'ZHB01' THEN
  GET STACKED DIAGNOSTICS rollback_message=MESSAGE_TEXT;
  RETURN rollback_message::jsonb || jsonb_build_object('rolled_back',true);
 END;
END;
$managed$;
REVOKE ALL ON FUNCTION public.admin_repair_historical_cb_scope(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_historical_cb_scope(jsonb,text) TO service_role;
