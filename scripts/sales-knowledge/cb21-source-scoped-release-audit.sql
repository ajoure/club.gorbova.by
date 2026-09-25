-- READ ONLY. Compare saleable CB21 add-ons with deliverable CB20 source rows.
-- Historic CB20/Club entitlements are intentionally outside this catalogue gate.
WITH pairs(role, offer_source_tariff, addon_source_tariff, target_tariff) AS (
 VALUES
 ('accountant','38ee08c4-21db-4a97-86e6-303bd96c48db'::uuid,'38ee08c4-21db-4a97-86e6-303bd96c48db'::uuid,'3c749a5d-fa43-5552-b064-c66611dedd58'::uuid),
 ('chief','a18df7a7-9c8b-4e63-9ea9-b6887c23927f'::uuid,'a18df7a7-9c8b-4e63-9ea9-b6887c23927f'::uuid,'3b427617-b192-57fa-9ac4-e85c28a7ad2f'::uuid),
 ('business','767bb895-30fa-49c9-8f31-d0794590020a'::uuid,'767bb895-30fa-49c9-8f31-d0794590020a'::uuid,'c558c63b-dd2f-5cc8-a990-ef4f0b3064c2'::uuid),
 ('alumni','98539e5d-cd29-4e5b-96cd-cb1e18579e2e'::uuid,'767bb895-30fa-49c9-8f31-d0794590020a'::uuid,'dbdb839e-84a0-4c00-8b8c-e60e4c558d94'::uuid)
),
checked_tariffs AS (
 SELECT target_tariff FROM pairs
 UNION SELECT '40240c3e-a2eb-40e6-8609-da2e17c910e5'::uuid
),
offers AS (
 SELECT p.role,t.id target_offer,addon_source.id addon_source_offer
 FROM pairs p
 JOIN public.tariff_offers t ON t.tariff_id=p.target_tariff AND t.is_active
   AND NOT coalesce((t.meta->>'sales_legacy_only')::boolean,false)
 JOIN public.tariff_offers s ON s.id::text=t.meta->>'source_offer_id'
   AND s.tariff_id=p.offer_source_tariff AND s.is_active
 JOIN public.tariff_offers addon_source ON addon_source.tariff_id=p.addon_source_tariff
   AND addon_source.is_active AND addon_source.meta->>'slot_role'=s.meta->>'slot_role'
),
source_rows AS (
 SELECT o.role,o.target_offer,a.id source_addon,a.addon_product_id,
 a.addon_offer_id,a.addon_tariff_id,
 EXISTS (
   SELECT 1 FROM public.access_rules r
   WHERE r.product_id=a.addon_product_id AND r.is_active AND r.tariff_id IS NULL
     AND coalesce(r.conditions->>'access_mode','full')='full'
     AND ((r.grant_target_type='training_content' AND EXISTS(
       SELECT 1 FROM public.training_modules m
       WHERE m.id::text=r.target_ref AND m.product_id=a.addon_product_id
         AND m.is_active AND m.parent_module_id IS NULL))
       OR (r.grant_target_type='product_access' AND r.target_ref=a.addon_product_id::text))
 ) deliverable
 FROM offers o
 JOIN public.offer_addons a ON a.parent_offer_id=o.addon_source_offer AND a.is_active
 JOIN public.products_v2 product ON product.id=a.addon_product_id AND product.is_active
 JOIN public.tariffs tariff ON tariff.id=a.addon_tariff_id AND tariff.is_active
 JOIN public.tariff_offers addon_offer ON addon_offer.id=a.addon_offer_id
   AND addon_offer.is_active AND addon_offer.amount>0
),
expected AS (SELECT * FROM source_rows WHERE deliverable),
actual AS (
 SELECT o.role,o.target_offer,a.addon_product_id,a.addon_offer_id,a.addon_tariff_id,
   a.meta->>'source_addon_id' source_addon,
   a.pricing_mode,a.discount_percent,a.is_required,a.is_default_selected,
   a.access_delivery_mode,a.access_opens_at,
   product.is_active product_active,addon_tariff.is_active addon_tariff_active,
   addon_offer.is_active addon_offer_active,addon_offer.amount addon_offer_amount
 FROM offers o JOIN public.offer_addons a ON a.parent_offer_id=o.target_offer AND a.is_active
 LEFT JOIN public.products_v2 product ON product.id=a.addon_product_id
 LEFT JOIN public.tariffs addon_tariff ON addon_tariff.id=a.addon_tariff_id
 LEFT JOIN public.tariff_offers addon_offer ON addon_offer.id=a.addon_offer_id
),
missing AS (
 SELECT e.target_offer,e.source_addon FROM expected e
 WHERE NOT EXISTS(SELECT 1 FROM actual a WHERE a.target_offer=e.target_offer
   AND a.source_addon=e.source_addon::text AND a.addon_product_id=e.addon_product_id
   AND a.addon_offer_id=e.addon_offer_id AND a.addon_tariff_id=e.addon_tariff_id)
),
unexpected AS (
 SELECT a.target_offer,a.source_addon FROM actual a
 WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE e.target_offer=a.target_offer
   AND e.source_addon::text=a.source_addon AND e.addon_product_id=a.addon_product_id
   AND e.addon_offer_id=a.addon_offer_id AND e.addon_tariff_id=a.addon_tariff_id)
),
invalid AS (
 SELECT 1 FROM actual a WHERE coalesce(a.is_required,true)
   OR coalesce(a.is_default_selected,true)
   OR NOT coalesce(a.product_active,false)
   OR NOT coalesce(a.addon_tariff_active,false)
   OR NOT coalesce(a.addon_offer_active,false)
   OR coalesce(a.addon_offer_amount,0)<=0
   OR a.access_delivery_mode IS DISTINCT FROM 'fixed_date'
   OR a.access_opens_at IS DISTINCT FROM '2026-12-09T21:00:00Z'::timestamptz
   OR (a.role IN('business','alumni') AND
     (a.pricing_mode IS DISTINCT FROM 'percent_discount' OR a.discount_percent IS DISTINCT FROM 50))
   OR (a.role IN('accountant','chief') AND
     (a.pricing_mode IS DISTINCT FROM 'offer_price' OR a.discount_percent IS NOT NULL))
),
paid_modules AS (
 SELECT m.id,m.product_id FROM public.training_modules m
 WHERE m.is_active AND m.product_id IN (SELECT DISTINCT addon_product_id FROM expected)
),
module_leaks AS (
 SELECT ma.module_id FROM public.module_access ma JOIN paid_modules m ON m.id=ma.module_id
 WHERE ma.tariff_id IN (SELECT target_tariff FROM checked_tariffs)
),
rule_leaks AS (
 SELECT DISTINCT r.id FROM public.access_rules r JOIN paid_modules m ON
   r.target_ref=m.id::text OR (r.conditions ? 'allowed_module_ids'
     AND (r.conditions->'allowed_module_ids') ? m.id::text)
   OR (r.grant_target_type='product_access' AND r.target_ref=m.product_id::text)
 WHERE r.is_active AND r.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid
   AND (r.tariff_id IS NULL OR r.tariff_id IN (SELECT target_tariff FROM checked_tariffs))
),
legacy_alumni_addons AS (
 SELECT a.id
 FROM public.tariff_offers o
 JOIN public.offer_addons a ON a.parent_offer_id=o.id AND a.is_active
 WHERE o.tariff_id='dbdb839e-84a0-4c00-8b8c-e60e4c558d94'::uuid
   AND coalesce((o.meta->>'sales_legacy_only')::boolean,false)
)
SELECT jsonb_build_object(
 'target_offers',(SELECT count(*) FROM offers),
 'offer_role_cardinality_mismatches',(SELECT count(*) FROM (
   SELECT role FROM offers GROUP BY role HAVING count(*)<>4
 ) bad_roles),
 'source_deliverable_products',(SELECT count(DISTINCT addon_product_id) FROM expected),
 'source_undeliverable_products',(SELECT count(DISTINCT addon_product_id) FROM source_rows WHERE NOT deliverable),
 'expected_active_rows',(SELECT count(*) FROM expected),
 'actual_active_rows',(SELECT count(*) FROM actual),
 'missing_rows',(SELECT count(*) FROM missing),
 'unexpected_rows',(SELECT count(*) FROM unexpected),
 'duplicate_rows',(SELECT count(*) FROM (
   SELECT target_offer,source_addon FROM actual GROUP BY target_offer,source_addon HAVING count(*)>1
 ) d),
 'invalid_settings',(SELECT count(*) FROM invalid),
 'base_module_leaks',(SELECT count(*) FROM module_leaks),
 'base_rule_leaks',(SELECT count(*) FROM rule_leaks),
 'legacy_alumni_active_addons',(SELECT count(*) FROM legacy_alumni_addons),
 'configuration_pass',
   (SELECT count(*) FROM offers)=16
   AND (SELECT count(*) FROM (
     SELECT role FROM offers GROUP BY role HAVING count(*)<>4
   ) bad_roles)=0
   AND (SELECT count(DISTINCT addon_product_id) FROM expected)=8
   AND (SELECT count(DISTINCT addon_product_id) FROM source_rows WHERE NOT deliverable)=1
   AND (SELECT count(*) FROM expected)=128
   AND (SELECT count(*) FROM actual)=(SELECT count(*) FROM expected)
   AND (SELECT count(*) FROM missing)=0
   AND (SELECT count(*) FROM unexpected)=0
   AND (SELECT count(*) FROM (
     SELECT target_offer,source_addon FROM actual GROUP BY target_offer,source_addon HAVING count(*)>1
   ) d)=0
   AND (SELECT count(*) FROM invalid)=0
   AND (SELECT count(*) FROM module_leaks)=0
   AND (SELECT count(*) FROM rule_leaks)=0
   AND (SELECT count(*) FROM legacy_alumni_addons)=0
) AS cb21_source_scoped_release_audit;
