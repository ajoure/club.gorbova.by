-- READ-ONLY catalogue comparison for CB20 -> CB21.
-- Run only through the canonical managed Lovable read path.  The source
-- catalogue is derived from active CB20 offer rows and delivery configuration;
-- no fixed number of modules, offers, or paid add-ons is assumed.
-- The result contains only configuration aggregates and technical product IDs.

WITH course_products(scope, product_id) AS (
  VALUES
    ('cb20'::text, '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid),
    ('cb21'::text, '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid)
),
active_addons AS (
  SELECT
    course.scope,
    addon.id AS addon_rule_id,
    addon.addon_product_id,
    parent_offer.id AS parent_offer_id,
    addon_product.name AS addon_product_name
  FROM course_products course
  JOIN public.tariffs parent_tariff
    ON parent_tariff.product_id = course.product_id
   AND parent_tariff.is_active
   AND parent_tariff.is_public
  JOIN public.tariff_offers parent_offer
    ON parent_offer.tariff_id = parent_tariff.id
   AND parent_offer.is_active
  JOIN public.offer_addons addon
    ON addon.parent_offer_id = parent_offer.id
   AND addon.is_active
  JOIN public.tariffs addon_tariff
    ON addon_tariff.id = addon.addon_tariff_id
   AND addon_tariff.is_active
  JOIN public.tariff_offers addon_offer
    ON addon_offer.id = addon.addon_offer_id
   AND addon_offer.is_active
  JOIN public.products_v2 addon_product
    ON addon_product.id = addon.addon_product_id
   AND addon_product.is_active
),
addon_products AS (
  SELECT DISTINCT addon_product_id
  FROM active_addons
),
delivery AS (
  SELECT
    addon_product.addon_product_id,
    count(DISTINCT root_module.id) FILTER (
      WHERE root_module.is_active
        AND root_module.parent_module_id IS NULL
    )::int AS active_root_training_modules,
    count(DISTINCT delivery_rule.id) FILTER (
      WHERE delivery_rule.is_active
        AND delivery_rule.tariff_id IS NULL
        AND coalesce(delivery_rule.conditions->>'access_mode', 'full') = 'full'
        AND (
          (delivery_rule.grant_target_type = 'training_content'
            AND delivery_rule.target_ref = root_module.id::text)
          OR (delivery_rule.grant_target_type = 'product_access'
            AND delivery_rule.target_ref = addon_product.addon_product_id::text)
        )
    )::int AS full_product_delivery_rules
    ,count(DISTINCT delivery_rule.id) FILTER (
      WHERE delivery_rule.is_active
        AND delivery_rule.tariff_id IS NULL
        AND coalesce(delivery_rule.conditions->>'access_mode', 'full') = 'full'
        AND delivery_rule.grant_target_type = 'product_access'
        AND delivery_rule.target_ref = addon_product.addon_product_id::text
    )::int AS full_product_access_rules
  FROM addon_products addon_product
  LEFT JOIN public.training_modules root_module
    ON root_module.product_id = addon_product.addon_product_id
   AND root_module.is_active
   AND root_module.parent_module_id IS NULL
  LEFT JOIN public.access_rules delivery_rule
    ON delivery_rule.product_id = addon_product.addon_product_id
   AND delivery_rule.is_active
   AND delivery_rule.tariff_id IS NULL
   AND (
     (delivery_rule.grant_target_type = 'training_content'
       AND delivery_rule.target_ref = root_module.id::text)
     OR (delivery_rule.grant_target_type = 'product_access'
       AND delivery_rule.target_ref = addon_product.addon_product_id::text)
   )
  GROUP BY addon_product.addon_product_id
),
catalogue AS (
  SELECT
    active.scope,
    active.addon_product_id AS product_id,
    coalesce(max(active.addon_product_name), '') AS product_name,
    count(DISTINCT active.addon_rule_id)::int AS active_addon_rows,
    count(DISTINCT active.parent_offer_id)::int AS active_parent_offers,
    delivery.active_root_training_modules,
    delivery.full_product_delivery_rules,
    delivery.full_product_access_rules,
    (
      delivery.full_product_delivery_rules > 0
      AND (
        delivery.active_root_training_modules > 0
        OR delivery.full_product_access_rules > 0
      )
    ) AS deliverable
  FROM active_addons active
  JOIN delivery ON delivery.addon_product_id = active.addon_product_id
  GROUP BY
    active.scope,
    active.addon_product_id,
    delivery.active_root_training_modules,
    delivery.full_product_delivery_rules,
    delivery.full_product_access_rules
),
source_deliverable AS (
  SELECT product_id FROM catalogue WHERE scope = 'cb20' AND deliverable
),
target_deliverable AS (
  SELECT product_id FROM catalogue WHERE scope = 'cb21' AND deliverable
)
SELECT jsonb_build_object(
  'cb20', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_name', product_name,
      'active_addon_rows', active_addon_rows,
      'active_parent_offers', active_parent_offers,
      'active_root_training_modules', active_root_training_modules,
      'full_product_delivery_rules', full_product_delivery_rules,
      'full_product_access_rules', full_product_access_rules,
      'deliverable', deliverable
    ) ORDER BY product_name, product_id)
    FROM catalogue
    WHERE scope = 'cb20'
  ), '[]'::jsonb),
  'cb21', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_name', product_name,
      'active_addon_rows', active_addon_rows,
      'active_parent_offers', active_parent_offers,
      'active_root_training_modules', active_root_training_modules,
      'full_product_delivery_rules', full_product_delivery_rules,
      'full_product_access_rules', full_product_access_rules,
      'deliverable', deliverable
    ) ORDER BY product_name, product_id)
    FROM catalogue
    WHERE scope = 'cb21'
  ), '[]'::jsonb),
  'source_only_deliverable_products', coalesce((
    SELECT jsonb_agg(product_id ORDER BY product_id)
    FROM source_deliverable
    WHERE NOT EXISTS (
      SELECT 1 FROM target_deliverable target
      WHERE target.product_id = source_deliverable.product_id
    )
  ), '[]'::jsonb),
  'target_only_deliverable_products', coalesce((
    SELECT jsonb_agg(product_id ORDER BY product_id)
    FROM target_deliverable
    WHERE NOT EXISTS (
      SELECT 1 FROM source_deliverable source
      WHERE source.product_id = target_deliverable.product_id
    )
  ), '[]'::jsonb),
  'cb20_deliverable_product_count', (SELECT count(*) FROM source_deliverable),
  'cb21_deliverable_product_count', (SELECT count(*) FROM target_deliverable),
  'cb20_incomplete_product_count', (SELECT count(*) FROM catalogue WHERE scope = 'cb20' AND NOT deliverable),
  'cb21_incomplete_product_count', (SELECT count(*) FROM catalogue WHERE scope = 'cb21' AND NOT deliverable)
) AS cb20_cb21_source_catalogue_audit;
