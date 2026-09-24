-- READ-ONLY legacy continuity audit for the former fixed CB21 add-on scope.
-- Run only through the canonical managed Lovable read path.
-- It returns aggregate configuration and entitlement anomalies: no personal data,
-- no payment URLs, and no writes.
-- It is not the CB20 -> CB21 catalogue source of truth: run
-- cb20-cb21-source-catalogue-audit.sql before deciding what CB21 may sell.

WITH policy AS (
  SELECT '2026-12-09T21:00:00Z'::timestamptz AS paid_addons_open_at
),
expected_parent_offers(parent_offer_id, audience) AS (
  VALUES
    ('5f79fccc-015f-5846-b423-aea2a2ba1ed1'::uuid, 'business'),
    ('1ec06293-920c-550d-bd14-4e8cbcdb5754'::uuid, 'business'),
    ('8028fdcf-fdf0-50fb-ad78-27dc3ca35e1a'::uuid, 'business'),
    ('91b14409-0e35-5034-aac7-ad820dbe871d'::uuid, 'business'),
    (md5('cb21-full-sync-v2:379f9ce6-5bbe-4d62-8881-b1f889547970')::uuid, 'alumni'),
    (md5('cb21-full-sync-v2:010982b2-c153-40c2-9b43-65d13894c508')::uuid, 'alumni'),
    (md5('cb21-full-sync-v2:7a3eb87b-79a8-4de7-b264-8b2c42b267d3')::uuid, 'alumni'),
    (md5('cb21-full-sync-v2:1134dda8-0089-4b4c-bbbc-2ef253a6aa26')::uuid, 'alumni')
),
catalogue AS (
  SELECT
    expected.parent_offer_id AS expected_parent_offer_id,
    expected.audience,
    rule.id AS addon_rule_id,
    rule.addon_product_id,
    rule.pricing_mode,
    rule.discount_percent,
    rule.is_required,
    rule.is_default_selected,
    rule.access_delivery_mode,
    rule.access_opens_at,
    parent.tariff_id AS parent_tariff_id,
    parent.is_active AS parent_offer_active,
    addon_product.name AS addon_product_name,
    addon_offer.is_active AS addon_offer_active,
    addon_offer.amount AS addon_offer_amount,
    addon_product.is_active AS addon_product_active,
    addon_tariff.is_active AS addon_tariff_active
  FROM expected_parent_offers expected
  LEFT JOIN public.offer_addons rule
    ON rule.parent_offer_id = expected.parent_offer_id
   AND rule.is_active
  LEFT JOIN public.tariff_offers parent ON parent.id = expected.parent_offer_id
  LEFT JOIN public.tariff_offers addon_offer ON addon_offer.id = rule.addon_offer_id
  LEFT JOIN public.products_v2 addon_product ON addon_product.id = rule.addon_product_id
  LEFT JOIN public.tariffs addon_tariff ON addon_tariff.id = rule.addon_tariff_id
),
addon_products AS (
  SELECT DISTINCT addon_product_id
  FROM catalogue
  WHERE addon_product_id IS NOT NULL
),
course_tariffs AS (
  SELECT DISTINCT parent_tariff_id AS tariff_id
  FROM catalogue
  WHERE parent_tariff_id IS NOT NULL
),
course_products AS (
  SELECT DISTINCT tariff.product_id
  FROM public.tariffs tariff
  JOIN course_tariffs course_tariff ON course_tariff.tariff_id = tariff.id
  WHERE tariff.product_id IS NOT NULL
),
paid_training_modules AS (
  SELECT module.id, module.product_id
  FROM public.training_modules module
  JOIN addon_products addon ON addon.addon_product_id = module.product_id
  WHERE module.is_active
),
paid_product_delivery AS (
  SELECT
    addon.addon_product_id,
    count(DISTINCT module.id) FILTER (
      WHERE module.is_active
        AND module.parent_module_id IS NULL
    )::int AS active_root_training_modules,
    count(DISTINCT access_rule.id) FILTER (
      WHERE access_rule.is_active
        AND access_rule.product_id = addon.addon_product_id
        AND access_rule.tariff_id IS NULL
        AND coalesce(access_rule.conditions->>'access_mode', 'full') = 'full'
        AND (
          (access_rule.grant_target_type = 'training_content'
            AND access_rule.target_ref = module.id::text)
          OR (access_rule.grant_target_type = 'product_access'
            AND access_rule.target_ref = addon.addon_product_id::text)
        )
    )::int AS full_product_delivery_rules
  FROM addon_products addon
  LEFT JOIN public.training_modules module
    ON module.product_id = addon.addon_product_id
   AND module.is_active
   AND module.parent_module_id IS NULL
  LEFT JOIN public.access_rules access_rule
    ON access_rule.product_id = addon.addon_product_id
   AND access_rule.is_active
   AND access_rule.tariff_id IS NULL
   AND (
     (access_rule.grant_target_type = 'training_content'
       AND access_rule.target_ref = module.id::text)
     OR (access_rule.grant_target_type = 'product_access'
       AND access_rule.target_ref = addon.addon_product_id::text)
   )
  GROUP BY addon.addon_product_id
),
paid_product_details AS (
  SELECT
    delivery.addon_product_id AS product_id,
    coalesce(max(catalogue.addon_product_name), '') AS product_name,
    delivery.active_root_training_modules,
    delivery.full_product_delivery_rules,
    count(DISTINCT catalogue.addon_rule_id)::int AS active_addon_rows,
    (delivery.active_root_training_modules > 0 AND delivery.full_product_delivery_rules > 0) AS deliverable
  FROM paid_product_delivery delivery
  LEFT JOIN catalogue ON catalogue.addon_product_id = delivery.addon_product_id
  GROUP BY
    delivery.addon_product_id,
    delivery.active_root_training_modules,
    delivery.full_product_delivery_rules
),
base_tariff_module_access_leaks AS (
  SELECT module_access.module_id, module_access.tariff_id
  FROM public.module_access module_access
  JOIN paid_training_modules module ON module.id = module_access.module_id
  JOIN course_tariffs course_tariff ON course_tariff.tariff_id = module_access.tariff_id
),
base_tariff_cross_product_rule_leaks AS (
  SELECT DISTINCT access_rule.id
  FROM public.access_rules access_rule
  JOIN course_products course_product ON course_product.product_id = access_rule.product_id
  JOIN paid_training_modules module ON (
    access_rule.target_ref = module.id::text
    OR (access_rule.conditions ? 'allowed_module_ids'
        AND (access_rule.conditions->'allowed_module_ids') ? module.id::text)
    OR (access_rule.grant_target_type = 'product_access'
        AND access_rule.target_ref = module.product_id::text)
  )
  WHERE access_rule.is_active
    AND (access_rule.tariff_id IS NULL OR access_rule.tariff_id IN (SELECT tariff_id FROM course_tariffs))
),
per_parent AS (
  SELECT
    expected_parent_offer_id,
    audience,
    bool_or(parent_offer_active) AS parent_offer_active,
    count(addon_rule_id)::int AS active_addon_rows
  FROM catalogue
  GROUP BY expected_parent_offer_id, audience
),
paid_orders AS (
  SELECT DISTINCT o.user_id, o.product_id
  FROM public.orders_v2 o
  JOIN addon_products addon ON addon.addon_product_id = o.product_id
  WHERE o.status::text = 'paid'
    AND o.is_deleted IS NOT TRUE
    AND o.user_id IS NOT NULL
),
active_entitlements AS (
  SELECT e.user_id, e.product_id
  FROM public.entitlements e
  JOIN addon_products addon ON addon.addon_product_id = e.product_id
  WHERE e.status = 'active'
    AND (e.expires_at IS NULL OR e.expires_at > now())
),
scheduled AS (
  SELECT spa.product_id, spa.status, spa.opens_at
  FROM public.scheduled_product_access spa
  JOIN addon_products addon ON addon.addon_product_id = spa.product_id
),
catalogue_summary AS (
  SELECT jsonb_build_object(
    'expected_parent_offers', 8,
    'expected_active_addon_rows', 72,
    'active_addon_rows', (SELECT count(*) FROM catalogue WHERE addon_rule_id IS NOT NULL),
    'unique_addon_products', (SELECT count(*) FROM addon_products),
    'business_active_addon_rows', (SELECT count(*) FROM catalogue WHERE addon_rule_id IS NOT NULL AND audience = 'business'),
    'alumni_active_addon_rows', (SELECT count(*) FROM catalogue WHERE addon_rule_id IS NOT NULL AND audience = 'alumni'),
    'parent_offers_with_exactly_nine_addons', (SELECT count(*) FROM per_parent WHERE active_addon_rows = 9),
    'parent_details', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'parent_offer_id', expected_parent_offer_id,
        'audience', audience,
        'parent_offer_active', coalesce(parent_offer_active, false),
        'active_addon_rows', active_addon_rows
      ) ORDER BY audience, expected_parent_offer_id), '[]'::jsonb)
      FROM per_parent
    ),
    'paid_product_details', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product_id,
        'product_name', product_name,
        'active_root_training_modules', active_root_training_modules,
        'full_product_delivery_rules', full_product_delivery_rules,
        'active_addon_rows', active_addon_rows,
        'deliverable', deliverable
      ) ORDER BY product_id), '[]'::jsonb)
      FROM paid_product_details
    ),
    'paid_product_training_modules', (SELECT count(*) FROM paid_training_modules),
    'paid_products_without_active_root_training_module', (
      SELECT count(*) FROM paid_product_delivery WHERE active_root_training_modules = 0
    ),
    'paid_products_without_full_product_delivery_rule', (
      SELECT count(*) FROM paid_product_delivery WHERE full_product_delivery_rules = 0
    ),
    'undeliverable_paid_products', (
      SELECT count(*)
      FROM paid_product_delivery
      WHERE active_root_training_modules = 0
         OR full_product_delivery_rules = 0
    ),
    'base_tariff_module_access_leaks', (SELECT count(*) FROM base_tariff_module_access_leaks),
    'base_tariff_cross_product_rule_leaks', (SELECT count(*) FROM base_tariff_cross_product_rule_leaks),
    'cardinality_mismatches', (SELECT count(*) FROM per_parent WHERE active_addon_rows <> 9),
    'invalid_active_addon_rules', (
      SELECT count(*)
      FROM catalogue c, policy p
      WHERE c.addon_rule_id IS NOT NULL
        AND (
          NOT coalesce(c.parent_offer_active, false)
          OR NOT coalesce(c.addon_offer_active, false)
          OR NOT coalesce(c.addon_product_active, false)
          OR NOT coalesce(c.addon_tariff_active, false)
          OR coalesce(c.addon_offer_amount, 0) <= 0
          OR c.pricing_mode IS DISTINCT FROM 'percent_discount'
          OR c.discount_percent IS DISTINCT FROM 50
          OR coalesce(c.is_required, true)
          OR coalesce(c.is_default_selected, true)
          OR c.access_delivery_mode IS DISTINCT FROM 'fixed_date'
          OR c.access_opens_at IS DISTINCT FROM p.paid_addons_open_at
        )
    )
  ) AS result
),
fulfilment_summary AS (
  SELECT jsonb_build_object(
    'active_addon_entitlements', (SELECT count(*) FROM active_entitlements),
    'active_entitlements_before_release', (
      SELECT count(*)
      FROM active_entitlements, policy
      WHERE now() < policy.paid_addons_open_at
    ),
    'active_without_matching_paid_order_review', (
      SELECT count(*)
      FROM active_entitlements entitlement
      WHERE NOT EXISTS (
        SELECT 1
        FROM paid_orders order_fact
        WHERE order_fact.user_id = entitlement.user_id
          AND order_fact.product_id = entitlement.product_id
      )
    ),
    'scheduled_or_failed_access', (
      SELECT count(*)
      FROM scheduled
      WHERE status IN ('scheduled', 'activating', 'failed')
    ),
    'activated_scheduled_access', (SELECT count(*) FROM scheduled WHERE status = 'activated'),
    'scheduled_before_release', (
      SELECT count(*)
      FROM scheduled, policy
      WHERE status = 'scheduled'
        AND opens_at > now()
        AND opens_at = policy.paid_addons_open_at
    ),
    'scheduled_with_wrong_opening', (
      SELECT count(*)
      FROM scheduled, policy
      WHERE opens_at IS DISTINCT FROM policy.paid_addons_open_at
    )
  ) AS result
)
SELECT jsonb_build_object(
  'catalogue', catalogue_summary.result,
  'fulfilment', fulfilment_summary.result
) AS cb21_paid_addon_audit
FROM catalogue_summary
CROSS JOIN fulfilment_summary;
