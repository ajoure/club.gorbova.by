-- Managed Lovable Cloud only. Execute after the merged deployment and fresh
-- owner UI refund_preflight proves both exact bePaid subscriptions terminal.
-- This repairs accounting references; it NEVER refunds or calls a provider.
-- Dry-run: run the whole transaction with the final COMMIT replaced by ROLLBACK.
BEGIN;
DO $$
DECLARE
 a constant uuid := 'e17b35b2-d908-48e1-b98f-ca5f86cdf579';
 b constant uuid := '9673e359-e98e-4e7e-8196-f31f60b4e16d';
 p1 constant uuid := '40f01f87-79c1-44cf-9148-64c71d0d871f';
 p2 constant uuid := '8401bbfb-1d90-4b3f-8738-7ce581a9bc51';
 p3 constant uuid := '1ad28122-537a-4272-8cc4-7df4cf4bd6ac';
 g constant uuid := '806f3295-6327-4831-b2c4-a6631b217fcf';
 item constant uuid := '0235abb4-67ee-4b36-b718-525957e5e9fa';
 link constant uuid := 'a11f2595-6bfc-486a-981c-3ebcd2706b39';
 marker constant text := 'installment-consolidation-20260911-v1';
 n integer; before_access jsonb; after_access jsonb; before_money jsonb;
BEGIN
 PERFORM id FROM orders_v2 WHERE id IN(a,b) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM orders_v2 WHERE id=b AND meta->>'repair_marker'=marker) THEN
   IF NOT EXISTS(SELECT 1 FROM orders_v2 WHERE id=a AND is_deleted AND meta->>'superseded_by'=b::text)
     OR NOT EXISTS(SELECT 1 FROM payments_v2 WHERE id=p1 AND order_id=b)
     OR NOT EXISTS(SELECT 1 FROM payment_links WHERE id=link AND status='invalidated') THEN
     RAISE EXCEPTION 'repair_marker_postcondition_mismatch';
   END IF;
   RAISE NOTICE 'Already applied; no writes'; RETURN;
 END IF;
 IF (SELECT count(*) FROM orders_v2 WHERE id IN(a,b) AND NOT is_deleted AND status='paid'
       AND final_price=663 AND currency='BYN' AND product_id='3e43fb28-8322-41bc-bfee-714731bdc630')<>2
    OR (SELECT count(DISTINCT user_id) FROM orders_v2 WHERE id IN(a,b))<>1 THEN
   RAISE EXCEPTION 'order_precondition_changed';
 END IF;
 PERFORM id FROM payments_v2 WHERE order_id IN(a,b) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM payments_v2 WHERE order_id IN(a,b) AND NOT coalesce(is_deleted,false))<>3
    OR (SELECT count(*) FROM payments_v2 WHERE id IN(p1,p2,p3) AND amount=663 AND status='succeeded'
         AND provider='bepaid' AND currency='BYN' AND coalesce(refunded_amount,0)=0
         AND NOT coalesce(is_deleted,false) AND ((id=p1 AND order_id=a) OR (id IN(p2,p3) AND order_id=b)))<>3
    OR NOT EXISTS(SELECT 1 FROM payments_v2 WHERE id=p3 AND provider_payment_id='6e1edf0b-1fb4-47a5-a048-6f937cce7d52')
    OR EXISTS(SELECT 1 FROM payment_refund_requests WHERE order_id IN(a,b) AND state<>'failed') THEN
   RAISE EXCEPTION 'payment_precondition_changed';
 END IF;
 PERFORM id FROM subscriptions_v2 WHERE order_id IN(a,b) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM subscriptions_v2 WHERE order_id IN(a,b))<>2
    OR NOT EXISTS(SELECT 1 FROM subscriptions_v2 WHERE id='c6633a7b-216f-41e5-b32a-cb771add4ad6'
      AND order_id=a AND status='canceled' AND NOT auto_renew AND next_charge_at IS NULL
      AND provider_subscription_id='sbs_9a86268a608fca3f')
    OR NOT EXISTS(SELECT 1 FROM subscriptions_v2 WHERE id='d16b01e5-efdd-43c8-a98c-c7d15daacfa7'
      AND order_id=b AND status='expired' AND NOT auto_renew AND next_charge_at IS NULL
      AND provider_subscription_id='sbs_bd6975629dfe2c83' AND access_end_at::date='2027-06-07')
    OR (SELECT count(*) FROM provider_subscriptions WHERE order_id IN(a,b) AND provider='bepaid'
      AND ((provider_subscription_id='sbs_9a86268a608fca3f' AND state='canceled')
        OR (provider_subscription_id='sbs_bd6975629dfe2c83' AND state='completed')))<>2 THEN
   RAISE EXCEPTION 'subscription_precondition_changed';
 END IF;
 SELECT jsonb_build_object('subscriptions',(SELECT jsonb_agg(jsonb_build_array(id,status,auto_renew,next_charge_at,access_start_at,access_end_at) ORDER BY id) FROM subscriptions_v2 WHERE order_id IN(a,b)),
   'entitlements',(SELECT jsonb_agg(jsonb_build_array(id,status,expires_at) ORDER BY id) FROM entitlements WHERE order_id IN(a,b))) INTO before_access;
 PERFORM id FROM order_groups WHERE id=g FOR UPDATE;
 PERFORM id FROM order_group_items WHERE order_group_id=g FOR UPDATE;
 PERFORM id FROM payment_links WHERE id=link FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM order_groups WHERE id=g AND primary_order_id=b AND total_amount=1325 AND subtotal=2650 AND adjustment_amount=-1325)
    OR (SELECT count(*) FROM order_group_items WHERE order_group_id=g)<>1
    OR NOT EXISTS(SELECT 1 FROM order_group_items WHERE id=item AND order_id=b AND final_amount=2650 AND list_amount=2650)
    OR EXISTS(SELECT 1 FROM payment_allocations WHERE order_group_item_id=item)
    OR NOT EXISTS(SELECT 1 FROM payment_links WHERE id=link AND order_group_id=g AND status='active'
      AND amount=66300 AND provider='bepaid' AND payment_type='subscription' AND max_uses IS NULL AND current_uses=0) THEN
   RAISE EXCEPTION 'group_or_link_precondition_changed';
 END IF;
 SELECT jsonb_build_object('orders',(SELECT jsonb_agg(jsonb_build_object('id',id,'final_price',final_price,'paid_amount',paid_amount,'installment_progress_money',jsonb_build_object('effective_total_byn',meta->'installment_progress'->'effective_total_byn','paid_total_byn',meta->'installment_progress'->'paid_total_byn','remaining_total_byn',meta->'installment_progress'->'remaining_total_byn')) ORDER BY id) FROM orders_v2 WHERE id IN(a,b)),
   'item_final',2650,'group_total',1325,'link_status','active','payment_1_order',a) INTO before_money;
 UPDATE payments_v2 SET order_id=b,meta=coalesce(meta,'{}')||jsonb_build_object('previous_order_id',a,'repair_marker',marker),updated_at=now() WHERE id=p1;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'payment_move_count'; END IF;
 UPDATE payments_v2 SET meta=coalesce(meta,'{}')||jsonb_build_object('refund_candidate',true,'repair_marker',marker),updated_at=now() WHERE id=p3;
 UPDATE orders_v2 SET final_price=1325,paid_amount=1989,
   meta=coalesce(meta,'{}')||jsonb_build_object('repair_marker',marker,'rounding_adjustment',1,'manual_review',true,
     'review_reason','Third charge 663 awaits refund; first two charges total 1326 against agreement 1325',
     'refund_candidate_payment_id',p3,'superseded_order_id',a,
     'installment_progress',coalesce(meta->'installment_progress','{}')||jsonb_build_object('effective_total_byn',1325,'paid_total_byn',1989,'remaining_total_byn',0,'billing_cycles',2,'paid_billing_cycles',2,'remaining_billing_cycles',0,'next_charge_at',null,'extra_payment_count',1),
     'installment',coalesce(meta->'installment','{}')||jsonb_build_object('effective_total_byn',1325,'billing_cycles',2,'per_payment_byn',663)),updated_at=now() WHERE id=b;
 UPDATE orders_v2 SET is_deleted=true,meta=coalesce(meta,'{}')||jsonb_build_object('superseded_by',b,'repair_marker',marker),updated_at=now() WHERE id=a;
 UPDATE order_group_items SET final_amount=1325,item_snapshot=coalesce(item_snapshot,'{}')||jsonb_build_object('final_amount',1325) WHERE id=item;
 UPDATE payment_links SET status='invalidated',updated_at=now() WHERE id=link;
 SELECT jsonb_build_object('subscriptions',(SELECT jsonb_agg(jsonb_build_array(id,status,auto_renew,next_charge_at,access_start_at,access_end_at) ORDER BY id) FROM subscriptions_v2 WHERE order_id IN(a,b)),
   'entitlements',(SELECT jsonb_agg(jsonb_build_array(id,status,expires_at) ORDER BY id) FROM entitlements WHERE order_id IN(a,b))) INTO after_access;
 IF before_access IS DISTINCT FROM after_access THEN RAISE EXCEPTION 'access_changed_rollback'; END IF;
 IF (SELECT count(*) FROM payments_v2 WHERE order_id=b AND id IN(p1,p2,p3) AND amount=663 AND status='succeeded' AND coalesce(refunded_amount,0)=0)<>3
    OR (SELECT count(*) FROM orders_v2 WHERE id IN(a,b) AND NOT is_deleted)<>1 THEN RAISE EXCEPTION 'repair_postcondition_failed'; END IF;
 INSERT INTO audit_logs(actor_type,actor_label,action,meta) VALUES('system','Codex via managed Lovable repair',
   'admin.installment.consolidated_without_refund',jsonb_build_object('repair_marker',marker,'before_money',before_money,
      'canonical_order_id',b,'archived_order_id',a,'moved_payment_id',p1,'refund_candidate_payment_id',p3,
      'payment_total',1989,'contract_amount',1325,'access_unchanged',true,'provider_writes',0));
 RAISE NOTICE 'PASS: orders 2 updated, payments 2 updated, item 1 updated, link 1 invalidated, audit 1 inserted; access/provider/refund writes 0';
END $$;
COMMIT;
