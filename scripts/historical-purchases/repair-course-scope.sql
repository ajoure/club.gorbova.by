-- Only repair already active Business course projections after this exact paid history batch.
-- No new entitlement, status/window change, or standalone grant.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $scope$
DECLARE
 do_execute boolean:=/* EXECUTE_FLAG */ false;
 payload jsonb:=/* PAYLOAD */ '[]'::jsonb;
 item jsonb; e public.entitlements%ROWTYPE; o public.orders_v2%ROWTYPE;
 before_row jsonb; after_row jsonb; patch jsonb; changed integer:=0;
 batch constant text:='hist-cb17-18-20260911-v1';
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
END;
$scope$;
COMMIT;
