-- Canonical Lovable Cloud operation. Facts only: zero new money, no standalone access.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $history$
DECLARE
 do_execute boolean := /* EXECUTE_FLAG */ false;
 payload jsonb := /* PAYLOAD */ '[]'::jsonb;
 batch_id text := 'hist-cb17-18-20260911-v1';
 item jsonb; p record; existing jsonb; prospective jsonb := '[]'::jsonb;
 new_ids uuid[] := '{}'::uuid[]; covered integer:=0; changed integer; new_count integer;
 is_module boolean; product_name text; product_code_value text; tariff_name text;
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
 IF NOT do_execute THEN RETURN; END IF;
 IF new_count=0 THEN RETURN; END IF;
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
END;
$history$;
COMMIT;
