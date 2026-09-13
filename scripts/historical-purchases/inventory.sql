-- Read-only inventory. Purchase evidence comes ONLY from nondeleted paid orders.
WITH RECURSIVE
source AS (
 SELECT * FROM jsonb_to_recordset(/* SOURCE */ '[]'::jsonb) AS s(
  refs jsonb,cohort int,email_sha256 text,phone_sha256 text,product_id uuid,tariff_id uuid,flow_id uuid,
  module_product_ids jsonb,titles_source_only jsonb)
),
module_catalog AS(SELECT unnest(ARRAY['64d9f812-617c-41a8-b3dc-bb113156d6f3','ea98d043-e852-443f-8807-6e77de6a5e1f',
 '99f1f156-f384-417e-bdf8-9203eb3c9d42','d7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c',
 '9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba','f833c846-a78d-4096-9dac-b8417d588371']) AS id),
pnorm AS (
 SELECT p.id,p.user_id,p.status,p.is_archived,p.merged_to_profile_id,
  CASE WHEN nullif(lower(btrim(p.email)),'') IS NOT NULL THEN encode(sha256(convert_to(lower(btrim(p.email)),'UTF8')),'hex') END AS eh,
  CASE WHEN length(regexp_replace(coalesce(p.phone,''),'\D','','g'))>=7 THEN encode(sha256(convert_to(regexp_replace(p.phone,'\D','','g'),'UTF8')),'hex') END AS ph
 FROM public.profiles p
),
chain AS (
 SELECT id AS origin_id,id AS candidate_id,merged_to_profile_id,ARRAY[id] AS path FROM pnorm
 UNION ALL
 SELECT c.origin_id,p.id,p.merged_to_profile_id,c.path||p.id FROM chain c JOIN pnorm p ON p.id=c.merged_to_profile_id
 WHERE NOT p.id=ANY(c.path) AND cardinality(c.path)<20
),
canonical AS (
 SELECT DISTINCT ON(origin_id) origin_id,candidate_id,merged_to_profile_id IS NULL AS valid
 FROM chain ORDER BY origin_id,cardinality(path) DESC
),
candidates AS (
 SELECT s.*,
  ARRAY(SELECT DISTINCT c.candidate_id FROM pnorm p JOIN canonical c ON c.origin_id=p.id
    WHERE p.eh=s.email_sha256 AND c.valid ORDER BY c.candidate_id) AS email_ids,
  ARRAY(SELECT DISTINCT c.candidate_id FROM pnorm p JOIN canonical c ON c.origin_id=p.id
    WHERE s.phone_sha256 IS NOT NULL AND p.ph=s.phone_sha256 AND c.valid ORDER BY c.candidate_id) AS phone_ids,
  ARRAY(SELECT p.id FROM pnorm p WHERE p.eh=s.email_sha256 AND p.merged_to_profile_id IS NOT NULL ORDER BY p.id) AS matched_alias_ids
 FROM source s
),
chosen AS (
 SELECT c.*,CASE WHEN cardinality(email_ids)=1 THEN email_ids[1]
  WHEN cardinality(email_ids)=0 AND cardinality(phone_ids)=1 THEN phone_ids[1] END AS chosen_id
 FROM candidates c
),
base AS (
 SELECT c.*,p.user_id,p.status AS profile_status,p.is_archived,p.merged_to_profile_id,
  CASE WHEN cardinality(email_ids)=1 THEN 'matched_email'
    WHEN cardinality(email_ids)>1 THEN 'ambiguous_email'
    WHEN cardinality(phone_ids)=1 THEN 'matched_phone_only'
    WHEN cardinality(phone_ids)>1 THEN 'ambiguous_phone' ELSE 'unmatched' END AS match_status,
  (cardinality(email_ids)=1 AND c.phone_sha256 IS NOT NULL AND p.ph IS DISTINCT FROM c.phone_sha256
    AND cardinality(phone_ids)>0) AS phone_conflict
 FROM chosen c LEFT JOIN pnorm p ON p.id=c.chosen_id
),
owned_orders AS (
 SELECT b.refs,o.* FROM base b JOIN public.orders_v2 o ON o.profile_id=b.chosen_id OR (b.user_id IS NOT NULL AND o.user_id=b.user_id)
 WHERE o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22' OR o.product_id::text IN(SELECT id FROM module_catalog)
),
paid_orders AS(SELECT * FROM owned_orders WHERE status::text='paid' AND is_deleted IS NOT TRUE),
module_evidence AS (
 SELECT o.*,ARRAY(SELECT DISTINCT value FROM (
   SELECT o.product_id::text AS value WHERE o.product_id::text IN(SELECT id FROM module_catalog)
   UNION ALL
   SELECT v.value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.purchase_snapshot->'module_list_mapped')='array'
     THEN o.purchase_snapshot->'module_list_mapped' ELSE '[]'::jsonb END) v
   WHERE o.purchase_snapshot->>'historical_purchase_type' IN('module_only_standalone','module_child_purchase','base_tariff_purchase')
     AND v.value IN(SELECT id FROM module_catalog)
 ) all_modules ORDER BY value) AS mapped_modules
 FROM paid_orders o
),
coverage AS (
 SELECT b.refs,ARRAY(SELECT DISTINCT unnest(m.mapped_modules) FROM module_evidence m WHERE m.refs=b.refs ORDER BY 1) AS covered
 FROM base b
),
result AS (
 SELECT b.refs,jsonb_build_object(
 'refs',b.refs,'match_status',b.match_status,'profile_id',b.chosen_id,'user_id',b.user_id,
 'profile_archived',b.is_archived,'profile_status',b.profile_status,'profile_merged_to',b.merged_to_profile_id,
 'candidates_email',to_jsonb(b.email_ids),'candidates_phone',to_jsonb(b.phone_ids),'matched_alias_ids',to_jsonb(b.matched_alias_ids),
 'phone_points_to_other_profile',b.phone_conflict,
 'phone_other_profile_ids',CASE WHEN b.phone_conflict THEN to_jsonb(b.phone_ids) ELSE '[]'::jsonb END,
 'titles_source_only',b.titles_source_only,'source_tariff_id',b.tariff_id,
 'module_list_requested_SOURCE_JSON_not_db',b.module_product_ids,
 'existing_paid_root_orders_db',coalesce((SELECT jsonb_agg(jsonb_build_object('order_id',o.id,'product_id',o.product_id,
   'tariff_id',o.tariff_id,'flow_id',o.flow_id,'hist_type',o.purchase_snapshot->>'historical_purchase_type',
   'profile_id',o.profile_id,'user_id',o.user_id,'reconcile_source',o.reconcile_source,
   'has_succeeded_payment',EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id AND p.status='succeeded')) ORDER BY o.id)
   FROM paid_orders o WHERE o.refs=b.refs AND o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22'),'[]'::jsonb),
 'existing_module_coverage_db',to_jsonb(c.covered),
 'existing_module_evidence_db',coalesce((SELECT jsonb_agg(jsonb_build_object('order_id',o.id,'product_id',o.product_id,
   'tariff_id',o.tariff_id,'hist_type',o.purchase_snapshot->>'historical_purchase_type','modules',to_jsonb(o.mapped_modules),
   'source',CASE WHEN o.product_id::text IN(SELECT id FROM module_catalog) THEN 'module_product_order' ELSE 'snapshot_component' END,
   'profile_id',o.profile_id,'user_id',o.user_id,'reconcile_source',o.reconcile_source,
   'split_from_order_id',o.purchase_snapshot->>'split_from_order_id','parent_order_id',o.purchase_snapshot->>'parent_order_id',
   'has_succeeded_payment',EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id AND p.status='succeeded')) ORDER BY o.id)
   FROM module_evidence o WHERE o.refs=b.refs AND cardinality(o.mapped_modules)>0),'[]'::jsonb),
 'deleted_orders_db',coalesce((SELECT jsonb_agg(jsonb_build_object('order_id',o.id,'product_id',o.product_id,'tariff_id',o.tariff_id) ORDER BY o.id)
   FROM owned_orders o WHERE o.refs=b.refs AND o.is_deleted IS TRUE),'[]'::jsonb),
 'missing_historical_fact',coalesce((SELECT jsonb_agg(v.value ORDER BY v.value) FROM jsonb_array_elements_text(b.module_product_ids) v WHERE NOT v.value=ANY(c.covered)),'[]'::jsonb),
 'shared_source_phone_with_refs',coalesce((SELECT jsonb_agg(s.refs ORDER BY s.refs) FROM source s WHERE b.phone_sha256 IS NOT NULL AND s.phone_sha256=b.phone_sha256 AND s.refs<>b.refs),'[]'::jsonb),
 'club_business_subscriptions',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'subscription_id',s.id,'status',s.status,'access_start_at',s.access_start_at,'access_end_at',s.access_end_at,
   'source_order_id',s.order_id,'order_status',o.status,'order_deleted',coalesce(o.is_deleted,false),
   'order_tariff_is_business',coalesce(o.tariff_id=s.tariff_id,false),'order_is_trial',coalesce(o.is_trial,false),
   'order_flags',jsonb_build_object('test',o.meta->'test','sandbox',o.meta->'sandbox','gift',o.meta->'gift'),
   'verified_paid_250',coalesce(o.status::text='paid' AND o.is_deleted IS NOT TRUE AND o.is_trial IS NOT TRUE AND s.is_trial IS NOT TRUE
      AND o.tariff_id=s.tariff_id AND o.product_id=s.product_id AND s.access_start_at<=now()
      AND s.status::text IN('active','past_due','canceled') AND s.access_end_at>now()
      AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(coalesce(o.meta,'{}')) f WHERE f.key IN('test','sandbox','gift') AND lower(f.value) IN('true','1'))
      AND (SELECT coalesce(sum(p.amount-coalesce(p.refunded_amount,0)),0) FROM public.payments_v2 p WHERE p.order_id=o.id AND p.status='succeeded' AND p.currency='BYN')>=250,false)) ORDER BY s.id)
   FROM public.subscriptions_v2 s LEFT JOIN public.orders_v2 o ON o.id=s.order_id
   WHERE s.user_id=b.user_id AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616' AND s.tariff_id='7c748940-dcad-4c7c-a92e-76a2344622d3'), '[]'::jsonb)
 ) AS row_data
 FROM base b JOIN coverage c ON c.refs=b.refs
)
SELECT jsonb_agg(row_data ORDER BY refs) AS inventory FROM result;
