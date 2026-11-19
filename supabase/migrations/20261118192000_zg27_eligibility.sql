-- ZG27: historical participation, not current access or lesson completion.
-- No financial, enrollment, access, or customer rows are modified here.
BEGIN;
CREATE OR REPLACE FUNCTION public.zg27_purchase_eligibility_v1(p_user_id uuid,p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
WITH scope(id,kind) AS (VALUES
 ('7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid,'cb'),
 ('3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,'cb'),
 ('2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid,'cb'),
 ('87a8870f-d426-419a-9f15-faa76c3f2be3'::uuid,'cb'),
 ('73c29914-63a3-4f4f-ac42-9f5287e58696'::uuid,'zg')
), profiles AS (
 SELECT p.id FROM public.profiles p WHERE p.user_id=p_user_id
), candidate_orders AS (
 SELECT o.*,s.kind FROM public.orders_v2 o JOIN scope s ON s.id=o.product_id
 WHERE p_user_id IS NOT NULL AND (o.user_id=p_user_id OR o.profile_id IN(SELECT id FROM profiles))
   AND o.is_deleted IS NOT TRUE AND o.status::text='paid' AND NOT coalesce(o.is_trial,false)
   AND coalesce(o.meta->>'financial_kind','') NOT IN('gift','test','sandbox','referral_redemption')
   AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'is_gift','false')<>'true'
   AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected'
   AND coalesce(o.meta->>'rejected_by_patch','false')<>'true'
   AND NOT coalesce(o.meta,'{}'::jsonb)?'rejected_at'
   AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','')
       NOT IN('module_only_standalone','module_child_purchase','module_purchase')
   AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE
     AND (pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))
), paid_proofs AS (
 SELECT o.id,o.kind FROM candidate_orders o WHERE
  (o.final_price>0 AND (SELECT coalesce(sum(pm.amount),0) FROM public.payments_v2 pm
    WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE AND pm.status::text='succeeded'
      AND pm.amount>0 AND pm.currency=o.currency)>=o.final_price)
  OR (o.deal_date IS NOT NULL AND (
    (o.meta->>'import_source'='patch4' AND nullif(o.meta->>'gc_deal_id','') IS NOT NULL)
    OR (o.meta->>'import_source'='csv_active_import' AND nullif(o.meta->>'source_file','') IS NOT NULL AND o.meta?'source_row_num')
    OR (o.meta->>'import_source'='revision_7101ed3c' AND o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid)
  ))
), enrollments AS (
 -- Protected canonical enrollment records include old imported rows without metadata.
 -- A derived module/Business grant is not an enrollment in the full course.
 SELECT s.kind FROM public.entitlements e JOIN scope s ON
   e.product_id=s.id OR (e.product_id IS NULL AND EXISTS(SELECT 1 FROM public.products_v2 p WHERE p.id=s.id AND p.code=e.product_code))
 WHERE p_user_id IS NOT NULL AND (e.user_id=p_user_id OR e.profile_id IN(SELECT id FROM profiles))
   AND e.status IN('active','expired')
   AND coalesce(e.meta->>'is_test','false')<>'true'
   AND coalesce(e.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
   AND coalesce(e.meta->>'source_type','') NOT IN('trial','test','sandbox')
   AND (coalesce(e.meta->>'granted_by','')<>'rule_engine_product_access'
     OR (e.meta->>'historical_purchase_type'='base_tariff_purchase'
       AND EXISTS(SELECT 1 FROM paid_proofs pp WHERE pp.id::text=e.meta->>'prior_purchase_order_id' AND pp.kind=s.kind)))
   AND (e.order_id IS NULL OR EXISTS(SELECT 1 FROM public.orders_v2 o WHERE o.id=e.order_id
     AND o.is_deleted IS NOT TRUE AND o.status::text IN('paid','partial')
       AND coalesce(o.meta->>'is_test','false')<>'true' AND NOT coalesce(o.is_trial,false)
       AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected'))
   AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=e.order_id AND pm.is_deleted IS NOT TRUE
     AND (pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))
 UNION ALL
 SELECT s.kind FROM public.subscriptions_v2 sub JOIN scope s ON s.id=sub.product_id
 LEFT JOIN public.orders_v2 o ON o.id=sub.order_id
 WHERE p_user_id IS NOT NULL AND (sub.user_id=p_user_id OR sub.profile_id IN(SELECT id FROM profiles))
   AND sub.status::text IN('active','expired','superseded') AND NOT coalesce(sub.is_trial,false)
   AND sub.access_start_at IS NOT NULL AND sub.access_start_at<=statement_timestamp()
   AND coalesce(sub.meta->>'is_test','false')<>'true'
   AND coalesce(sub.meta->>'source_type','') NOT IN('trial','test','sandbox','rule_engine')
   AND coalesce(sub.meta->>'historical_purchase_type',o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','')
       NOT IN('module_only_standalone','module_child_purchase','module_purchase')
   AND (sub.order_id IS NULL OR (o.id IS NOT NULL AND o.is_deleted IS NOT TRUE
     AND o.status::text IN('paid','partial')
     AND NOT coalesce(o.is_trial,false) AND coalesce(o.meta->>'is_test','false')<>'true'
     AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected'))
   AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=sub.order_id AND pm.is_deleted IS NOT TRUE
     AND (pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))
), evidence AS (
 SELECT kind FROM paid_proofs UNION ALL SELECT kind FROM enrollments
), result AS (
 SELECT EXISTS(SELECT 1 FROM evidence WHERE kind='cb') AS cb,
        EXISTS(SELECT 1 FROM evidence WHERE kind='zg') AS zg
)
SELECT jsonb_build_object(
 'eligible',p_product_id='e71c0dbb-baf2-4b6c-a950-bf0f728708af'::uuid AND p_user_id IS NOT NULL AND cb,
 'category',CASE WHEN p_product_id IS DISTINCT FROM 'e71c0dbb-baf2-4b6c-a950-bf0f728708af'::uuid OR p_user_id IS NULL OR NOT cb
   THEN 'not_eligible' WHEN zg THEN 'repeat' ELSE 'first' END,
 'policy_version','zg27-v1') FROM result;
$fn$;
REVOKE ALL ON FUNCTION public.zg27_purchase_eligibility_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zg27_purchase_eligibility_v1(uuid,uuid) TO service_role;
COMMIT;
