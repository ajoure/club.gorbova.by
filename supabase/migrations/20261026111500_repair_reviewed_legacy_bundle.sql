-- Owner-confirmed historical bundle; selectors are opaque row fingerprints.
-- The original manual order has no offer. Preserve that fact and its gross
-- amount. Group-item offer references below are historical pricing evidence,
-- not a claim that the buyer clicked those offers. No payments or messages.
SET lock_timeout = '3s';
SET statement_timeout = '15s';
DO $repair$
DECLARE
  selector_hash CONSTANT text := '2691951945784695c32d9a7365cdf89c';
  payment_selector_hash CONSTANT text := '0bedec3f5f3cc283b2711c5ef3471bb5';
  approved_order_hash CONSTANT text := '4ffdfb9d0ab4ebbcc639876442cc323e';
  approved_payment_hash CONSTANT text := '8b2ba06891b172f1da866a8106a0fba7';
  approved_access_hash CONSTANT text := 'e66e602f6b7a017a50580ccd8a8198ad';
  repair_key CONSTANT text := 'legacy_bundle_269195194578_v1';
  catalog CONSTANT jsonb := '[
    {"product_id":"3e43fb28-8322-41bc-bfee-714731bdc630","tariff_id":"767bb895-30fa-49c9-8f31-d0794590020a","offer_id":"4c6d6110-5c9b-419c-82ef-524dfe44ecc1","role":"primary","list_amount":2650,"discount_amount":0,"final_amount":2650},
    {"product_id":"abee24cd-5c8b-4111-a6cb-7dee7acf168c","tariff_id":"0f5183d8-a610-416e-8d48-45eb47fba075","offer_id":"fe551573-32e4-447f-8ada-7e98d188d842","role":"addon","list_amount":500,"discount_amount":250,"final_amount":250,"access_delivery_mode":"immediate"},
    {"product_id":"64d9f812-617c-41a8-b3dc-bb113156d6f3","tariff_id":"2c84e74c-f4de-4cff-ad98-b4e1b2f53f93","offer_id":"270d72ec-d387-4fb0-a551-0208352413e6","role":"addon","list_amount":500,"discount_amount":250,"final_amount":250,"access_delivery_mode":"immediate"},
    {"product_id":"aa11cb00-0000-4000-8000-000000000001","tariff_id":"aa11cb00-0000-4000-8000-000000000101","offer_id":"9299ba09-8ab4-4514-bba3-bc8fd9134310","role":"addon","list_amount":500,"discount_amount":250,"final_amount":250,"access_delivery_mode":"manual"}
  ]'::jsonb;
  parent public.orders_v2%ROWTYPE;
  receipt public.payments_v2%ROWTYPE;
  base_access public.entitlements%ROWTYPE;
  group_id uuid;
  child_id uuid;
  item_id uuid;
  reserved_entitlement_id uuid;
  item jsonb;
  quote jsonb;
  aggregate_result jsonb;
  addon_products uuid[];
  ready_products uuid[];
  original_parent jsonb;
  original_access jsonb;
  original_subscriptions jsonb;
  already_done boolean := false;
  ordinal integer := 0;
BEGIN
  PERFORM set_config('TimeZone','UTC',true);
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname,md5(p.prosrc)) IN (
      ('materialize_composable_order_group','172cc15bc2a4efbf41c9bd6fe1ae7514'),
      ('settle_composable_order_group','d186f80410345970cc3e6362c1e0b419'),
      ('recalculate_entitlement_aggregate','31533b270a7d0576e30306a6e6814b56'),
      ('tariff_access_rank','c52b039492ddbdf6fd9a2da5e4e3e640')))<>4 THEN
    RAISE EXCEPTION 'legacy_bundle_procedure_changed';
  END IF;
  SELECT * INTO STRICT parent FROM public.orders_v2
    WHERE md5(id::text)=selector_hash FOR UPDATE;
  PERFORM 1 FROM public.payments_v2 WHERE order_id=parent.id ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT receipt FROM public.payments_v2
    WHERE order_id=parent.id AND md5(id::text)=payment_selector_hash FOR UPDATE;
  IF md5(to_jsonb(receipt)::text) IS DISTINCT FROM approved_payment_hash THEN
    RAISE EXCEPTION 'legacy_bundle_receipt_fingerprint_changed (expected %, got %)',approved_payment_hash,md5(to_jsonb(receipt)::text);
  END IF;
  SELECT * INTO STRICT base_access FROM public.entitlements
    WHERE order_id=parent.id AND user_id=parent.user_id AND product_id=parent.product_id FOR UPDATE;
  IF parent.status::text IS DISTINCT FROM 'paid' OR coalesce(parent.is_deleted,false)
    OR parent.user_id IS NULL OR parent.profile_id IS NULL OR parent.offer_id IS NOT NULL
    OR parent.product_id IS DISTINCT FROM (catalog->0->>'product_id')::uuid
    OR parent.tariff_id IS DISTINCT FROM (catalog->0->>'tariff_id')::uuid
    OR parent.base_price IS DISTINCT FROM 3400 OR parent.final_price IS DISTINCT FROM 3400
    OR parent.paid_amount IS DISTINCT FROM 3400 OR parent.currency IS DISTINCT FROM 'BYN'
    OR receipt.amount IS DISTINCT FROM 3400 OR receipt.currency IS DISTINCT FROM 'BYN'
    OR receipt.status::text IS DISTINCT FROM 'succeeded'
    OR coalesce(receipt.is_deleted,false) OR coalesce(receipt.refunded_amount,0)<>0
    OR receipt.provider IS DISTINCT FROM 'rr' OR receipt.origin IS DISTINCT FROM 'manual_admin'
    OR receipt.user_id IS DISTINCT FROM parent.user_id OR receipt.profile_id IS DISTINCT FROM parent.profile_id
    OR receipt.paid_at IS DISTINCT FROM '2026-07-24T12:49:00Z'::timestamptz
    OR base_access.status IS DISTINCT FROM 'active' OR base_access.expires_at IS DISTINCT FROM '2027-05-20T12:49:00Z'::timestamptz
    OR md5(jsonb_build_array(base_access.user_id,base_access.product_id,base_access.order_id,base_access.status,base_access.expires_at)::text)<>approved_access_hash
    OR coalesce(parent.meta->>'do_not_grant_access','false') NOT IN ('false','')
    OR coalesce(parent.meta->>'refund_candidate','false') NOT IN ('false','') THEN
    RAISE EXCEPTION 'legacy_bundle_financial_or_window_changed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=parent.id AND p.id<>receipt.id
    AND NOT coalesce(p.is_deleted,false) AND (p.amount<0 OR coalesce(p.refunded_amount,0)>0
      OR (p.amount>0 AND p.status::text IN ('succeeded','refunded','partially_refunded'))))
    OR EXISTS(SELECT 1 FROM public.payment_refund_requests r
      WHERE (to_jsonb(r)->>'order_id'=parent.id::text OR to_jsonb(r)->>'payment_id'=receipt.id::text)
        AND coalesce(to_jsonb(r)->>'state','pending') NOT IN ('failed','cancelled','rejected')) THEN
    RAISE EXCEPTION 'legacy_bundle_refund_or_extra_receipt';
  END IF;
  SELECT array_agg((x->>'product_id')::uuid) INTO addon_products
    FROM jsonb_array_elements(catalog) x WHERE x->>'role'='addon';
  SELECT array_agg((x->>'product_id')::uuid) INTO ready_products
    FROM jsonb_array_elements(catalog) x WHERE x->>'access_delivery_mode'='immediate';
  SELECT id INTO group_id FROM public.order_groups WHERE primary_order_id=parent.id FOR UPDATE;
  already_done:=group_id IS NOT NULL;
  IF already_done THEN
    IF parent.meta#>>'{legacy_bundle_repair,key}' IS DISTINCT FROM repair_key
      OR parent.meta#>>'{legacy_bundle_repair,approved_order_hash}' IS DISTINCT FROM approved_order_hash
      OR NOT EXISTS(SELECT 1 FROM public.order_groups WHERE id=group_id AND idempotency_key=repair_key) THEN
      RAISE EXCEPTION 'legacy_bundle_existing_group_requires_review';
    END IF;
  ELSE
    IF md5(to_jsonb(parent)::text)<>approved_order_hash
      OR nullif(parent.meta->>'order_group_id','') IS NOT NULL
      OR parent.meta ? 'composable_checkout'
      OR EXISTS(SELECT 1 FROM public.entitlements WHERE user_id=parent.user_id AND product_id=ANY(addon_products))
      OR EXISTS(SELECT 1 FROM public.entitlement_sources WHERE user_id=parent.user_id AND product_id=ANY(addon_products))
      OR EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE user_id=parent.user_id AND product_id=ANY(addon_products))
      OR EXISTS(SELECT 1 FROM public.orders_v2 WHERE order_number IN
        (parent.order_number||'-A1',parent.order_number||'-A2',parent.order_number||'-A3')) THEN
      RAISE EXCEPTION 'legacy_bundle_preflight_changed_or_access_override';
    END IF;
  END IF;
  original_parent:=(to_jsonb(parent)-'meta'-'updated_at')||jsonb_build_object('meta',
    coalesce(parent.meta,'{}'::jsonb)-'order_group_id'-'composable_checkout'-'single_crm_deal'-'legacy_bundle_repair');
  SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) INTO original_access FROM public.entitlements e
    WHERE e.user_id=parent.user_id AND NOT coalesce(e.product_id=ANY(addon_products),false);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO original_subscriptions FROM public.subscriptions_v2 s WHERE s.user_id=parent.user_id;

  IF NOT already_done THEN
    FOR item IN SELECT x FROM jsonb_array_elements(catalog) x LOOP
      IF NOT EXISTS(SELECT 1 FROM public.tariff_offers o JOIN public.tariffs t ON t.id=o.tariff_id
        WHERE o.id=(item->>'offer_id')::uuid AND t.id=(item->>'tariff_id')::uuid
          AND t.product_id=(item->>'product_id')::uuid AND o.amount=(item->>'list_amount')::numeric
          AND o.created_at<=receipt.paid_at) THEN
        RAISE EXCEPTION 'legacy_bundle_historical_pricing_changed';
      END IF;
      IF item->>'role'='addon' AND NOT EXISTS(SELECT 1 FROM public.offer_addons a
        WHERE a.parent_offer_id=(catalog->0->>'offer_id')::uuid
          AND a.addon_product_id=(item->>'product_id')::uuid
          AND a.addon_tariff_id=(item->>'tariff_id')::uuid AND a.addon_offer_id=(item->>'offer_id')::uuid
          AND a.pricing_mode='percent_discount' AND a.discount_percent=50 AND a.created_at<=receipt.paid_at) THEN
        RAISE EXCEPTION 'legacy_bundle_historical_discount_changed';
      END IF;
    END LOOP;
    quote:=jsonb_build_object('items',catalog,'currency','BYN','subtotal',3400,'adjustment_amount',0,'total',3400,
      'historical_reconstruction',true,'original_order_offer_id',parent.offer_id,
      'pricing_basis','prepurchase_catalog_and_owner_confirmed_composition');
    -- New-checkout materialize RPC requires the original offer to match and be
    -- non-null. Historical reconstruction must not invent a selected offer on
    -- the old manual order, so use its canonical table shape in this one batch.
    INSERT INTO public.order_groups(group_number,profile_id,user_id,primary_order_id,payer_type,status,currency,
      subtotal,adjustment_amount,total_amount,payment_method,source,idempotency_key,quote_snapshot,meta,paid_at)
    VALUES('GRP-'||parent.order_number,parent.profile_id,parent.user_id,parent.id,parent.payer_type,'paid','BYN',
      3400,0,3400,parent.meta->>'payment_method','owner_confirmed_historical',repair_key,quote,
      jsonb_build_object('single_crm_deal',true,'separate_entitlements',true,'repair_key',repair_key),receipt.paid_at)
    RETURNING id INTO group_id;
    FOR item IN SELECT x FROM jsonb_array_elements(catalog) x LOOP
      item:=item||jsonb_build_object('historical_reconstruction',true,'pricing_offer_reference_only',true,
        'source_payment_id',receipt.id,'primary_order_id',parent.id,'original_course_end',base_access.expires_at);
      IF item->>'role'='primary' THEN child_id:=parent.id;
      ELSE
        INSERT INTO public.orders_v2(order_number,product_id,tariff_id,offer_id,profile_id,user_id,
          customer_email,customer_phone,payer_type,status,reconcile_source,base_price,final_price,paid_amount,
          currency,deal_date,purchase_snapshot,meta)
        VALUES(parent.order_number||'-A'||ordinal,(item->>'product_id')::uuid,(item->>'tariff_id')::uuid,
          (item->>'offer_id')::uuid,parent.profile_id,parent.user_id,parent.customer_email,parent.customer_phone,
          parent.payer_type,'paid','composable_checkout',500,250,250,'BYN',receipt.paid_at,item,
          jsonb_build_object('order_group_id',group_id,'group_primary_order_id',parent.id,'group_payment_id',receipt.id,
            'group_child_order',true,'exclude_separate_crm_deal',true,
            'paid_at',receipt.paid_at,'legacy_bundle_repair_key',repair_key)||
            CASE WHEN parent.meta ? 'deal_month' THEN jsonb_build_object('deal_month',parent.meta->'deal_month') ELSE '{}'::jsonb END)
        RETURNING id INTO child_id;
      END IF;
      INSERT INTO public.order_group_items(order_group_id,order_id,role,product_id,tariff_id,offer_id,
        list_amount,discount_amount,final_amount,sort_order,item_snapshot)
      VALUES(group_id,child_id,item->>'role',(item->>'product_id')::uuid,(item->>'tariff_id')::uuid,
        (item->>'offer_id')::uuid,(item->>'list_amount')::numeric,(item->>'discount_amount')::numeric,
        (item->>'final_amount')::numeric,ordinal,item) RETURNING id INTO item_id;
      IF item->>'access_delivery_mode'='immediate' THEN
        -- Reserve the absent aggregate through its unique keys. A concurrent
        -- or legacy/manual grant wins instead of being overwritten by recalc.
        reserved_entitlement_id:=NULL;
        INSERT INTO public.entitlements(user_id,profile_id,product_id,product_code,order_id,status,expires_at,meta)
        SELECT parent.user_id,parent.profile_id,p.id,p.code,child_id,'active',base_access.expires_at,
          jsonb_build_object('legacy_bundle_repair_key',repair_key)
        FROM public.products_v2 p WHERE p.id=(item->>'product_id')::uuid
        ON CONFLICT DO NOTHING RETURNING id INTO reserved_entitlement_id;
        IF reserved_entitlement_id IS NULL THEN RAISE EXCEPTION 'legacy_bundle_existing_or_concurrent_access'; END IF;
        INSERT INTO public.entitlement_sources(source_type,source_ref,user_id,profile_id,product_id,tariff_id,
          order_id,starts_at,expires_at,status,meta)
        VALUES('order',child_id::text,parent.user_id,parent.profile_id,(item->>'product_id')::uuid,
          (item->>'tariff_id')::uuid,child_id,receipt.paid_at,base_access.expires_at,'active',
          jsonb_build_object('origin',repair_key,'primary_order_id',parent.id,'group_payment_id',receipt.id));
        SELECT public.recalculate_entitlement_aggregate(parent.user_id,(item->>'product_id')::uuid) INTO aggregate_result;
        IF aggregate_result->>'status'<>'active'
          OR (aggregate_result->>'entitlement_id')::uuid IS DISTINCT FROM reserved_entitlement_id THEN
          RAISE EXCEPTION 'legacy_bundle_access_aggregate_failed';
        END IF;
        UPDATE public.entitlements SET order_id=child_id,meta=coalesce(meta,'{}'::jsonb)||
          jsonb_build_object('granted_by','primary_order_fulfillment','legacy_bundle_repair_key',repair_key)
        WHERE id=(aggregate_result->>'entitlement_id')::uuid AND user_id=parent.user_id
          AND product_id=(item->>'product_id')::uuid AND order_id=child_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'legacy_bundle_access_lineage_changed'; END IF;
      ELSIF item->>'access_delivery_mode'='manual' THEN
        INSERT INTO public.scheduled_product_access(order_group_id,order_group_item_id,order_id,profile_id,user_id,
          product_id,tariff_id,offer_id,access_delivery_mode,opens_at,access_duration_days,status,purchase_confirmed_at,access_snapshot,meta)
        VALUES(group_id,item_id,child_id,parent.profile_id,parent.user_id,(item->>'product_id')::uuid,
          (item->>'tariff_id')::uuid,(item->>'offer_id')::uuid,'manual',NULL,NULL,'scheduled',receipt.paid_at,item,
          jsonb_build_object('source',repair_key,'primary_order_id',parent.id,'original_course_end',base_access.expires_at));
      END IF;
      ordinal:=ordinal+1;
    END LOOP;
    PERFORM public.settle_composable_order_group(parent.id,receipt.id);
    UPDATE public.orders_v2 SET meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object(
      'order_group_id',group_id,'composable_checkout',quote,'single_crm_deal',true,
      'legacy_bundle_repair',jsonb_build_object('key',repair_key,'approved_order_hash',approved_order_hash,
        'approved_payment_hash',approved_payment_hash,'group_id',group_id,'completed_at',now())) WHERE id=parent.id;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
    VALUES('system','purchase.legacy_bundle_reconstructed','orders_v2',parent.id::text,
      jsonb_build_object('repair_key',repair_key,'group_id',group_id,'payment_id',receipt.id,
        'lines',ARRAY[2650,250,250,250],'new_payments',0,'ready_accesses',2,'manual_scheduled',1));
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.order_groups g WHERE g.id=group_id AND g.primary_order_id=parent.id
      AND g.user_id=parent.user_id AND g.profile_id=parent.profile_id AND g.total_amount=3400
      AND g.status='paid' AND g.paid_at=receipt.paid_at AND g.idempotency_key=repair_key)
    OR (SELECT count(*) FROM public.order_group_items WHERE order_group_id=group_id)<>4
    OR (SELECT count(*) FROM public.order_group_items i
      JOIN jsonb_array_elements(catalog) WITH ORDINALITY c(item,pos) ON i.sort_order=c.pos-1
      JOIN public.orders_v2 o ON o.id=i.order_id
      WHERE i.order_group_id=group_id AND i.product_id=(c.item->>'product_id')::uuid
        AND i.tariff_id=(c.item->>'tariff_id')::uuid AND i.offer_id=(c.item->>'offer_id')::uuid
        AND i.role=c.item->>'role' AND i.list_amount=(c.item->>'list_amount')::numeric
        AND i.discount_amount=(c.item->>'discount_amount')::numeric
        AND i.final_amount=(c.item->>'final_amount')::numeric AND o.user_id=parent.user_id
        AND o.profile_id=parent.profile_id AND o.product_id=i.product_id AND o.tariff_id=i.tariff_id
        AND o.currency='BYN' AND o.status::text='paid' AND NOT coalesce(o.is_deleted,false)
        AND (i.role='primary' OR (o.final_price=250 AND o.paid_amount=250 AND o.deal_date=receipt.paid_at)))<>4
    OR (SELECT array_agg(final_amount ORDER BY sort_order) FROM public.order_group_items WHERE order_group_id=group_id)
      IS DISTINCT FROM ARRAY[2650,250,250,250]::numeric[]
    OR (SELECT count(*) FROM public.payment_allocations WHERE order_group_id=group_id AND payment_id=receipt.id)<>4
    OR (SELECT sum(amount) FROM public.payment_allocations WHERE order_group_id=group_id)<>3400
    OR (SELECT count(*) FROM public.payment_allocations a JOIN public.order_group_items i
      ON i.id=a.order_group_item_id AND i.order_group_id=a.order_group_id
      WHERE a.order_group_id=group_id AND a.payment_id=receipt.id AND a.amount=i.final_amount AND a.refunded_amount=0)<>4
    OR EXISTS(SELECT 1 FROM public.payment_allocations WHERE order_group_id=group_id AND (payment_id<>receipt.id OR refunded_amount<>0))
    OR EXISTS(SELECT 1 FROM public.payments_v2 p JOIN public.order_group_items i ON i.order_id=p.order_id
      WHERE i.order_group_id=group_id AND i.role='addon')
    OR (SELECT count(*) FROM public.entitlements e JOIN public.order_group_items i ON i.order_id=e.order_id
      WHERE i.order_group_id=group_id AND e.user_id=parent.user_id AND e.product_id=ANY(ready_products)
        AND e.status='active' AND e.expires_at=base_access.expires_at)<>2
    OR (SELECT count(*) FROM public.entitlement_sources s JOIN public.order_group_items i ON i.order_id=s.order_id
      WHERE i.order_group_id=group_id AND s.source_type='order' AND s.source_ref=s.order_id::text
        AND s.user_id=parent.user_id AND s.product_id=ANY(ready_products) AND s.status='active'
        AND s.starts_at=receipt.paid_at AND s.expires_at=base_access.expires_at)<>2
    OR EXISTS(SELECT 1 FROM public.entitlements WHERE user_id=parent.user_id
      AND product_id=(catalog->3->>'product_id')::uuid)
    OR (SELECT count(*) FROM public.scheduled_product_access WHERE order_group_id=group_id
      AND product_id=(catalog->3->>'product_id')::uuid AND status='scheduled'
      AND access_delivery_mode='manual' AND opens_at IS NULL AND access_duration_days IS NULL)<>1 THEN
    RAISE EXCEPTION 'legacy_bundle_readback_failed';
  END IF;
  IF (SELECT (to_jsonb(o)-'meta'-'updated_at')||jsonb_build_object('meta',coalesce(o.meta,'{}'::jsonb)
      -'order_group_id'-'composable_checkout'-'single_crm_deal'-'legacy_bundle_repair')
      FROM public.orders_v2 o WHERE id=parent.id) IS DISTINCT FROM original_parent
    OR (SELECT md5(to_jsonb(p)::text) FROM public.payments_v2 p WHERE id=receipt.id)<>approved_payment_hash
    OR (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.entitlements e
      WHERE e.user_id=parent.user_id AND NOT coalesce(e.product_id=ANY(addon_products),false)) IS DISTINCT FROM original_access
    OR (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions_v2 s WHERE s.user_id=parent.user_id)
      IS DISTINCT FROM original_subscriptions THEN
    RAISE EXCEPTION 'legacy_bundle_unexpected_financial_or_access_change';
  END IF;
  RAISE NOTICE 'legacy_bundle: already_done=%, lines=4, allocations=4, active_access=2, scheduled=1, new_payments=0',already_done;
END;
$repair$;
RESET lock_timeout;
RESET statement_timeout;
