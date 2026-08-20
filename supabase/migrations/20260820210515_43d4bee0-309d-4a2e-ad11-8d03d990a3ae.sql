-- Restore the administrator-configured composable module matrix for
-- «Ценный бухгалтер | 1 ступень 2.0 | 21 поток» from the verified 20-flow
-- source. Module products stay canonical and independent; only offer_addons
-- links are copied. No orders, payments, contacts, or entitlements are touched.

BEGIN;

CREATE TEMP TABLE _cb21_tariff_map (
  source_tariff_id uuid PRIMARY KEY,
  target_tariff_id uuid UNIQUE NOT NULL,
  source_public_id text NOT NULL,
  target_public_id text NOT NULL,
  discounted boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO _cb21_tariff_map (
  source_tariff_id,
  target_tariff_id,
  source_public_id,
  target_public_id,
  discounted
)
SELECT
  source_tariff.id,
  target_tariff.id,
  mapping.source_public_id,
  mapping.target_public_id,
  mapping.discounted
FROM (
  VALUES
    ('T-000076'::text, 'T-000085'::text, false),
    ('T-000077'::text, 'T-000089'::text, false),
    ('T-000078'::text, 'T-000086'::text, true)
) AS mapping(source_public_id, target_public_id, discounted)
JOIN public.tariffs source_tariff
  ON source_tariff.public_id = mapping.source_public_id
JOIN public.products_v2 source_product
  ON source_product.id = source_tariff.product_id
 AND source_product.public_id = 'PRD-000039'
JOIN public.tariffs target_tariff
  ON target_tariff.public_id = mapping.target_public_id
JOIN public.products_v2 target_product
  ON target_product.id = target_tariff.product_id
 AND target_product.public_id = 'PRD-000044';

DO $$
BEGIN
  IF (SELECT count(*) FROM _cb21_tariff_map) <> 3 THEN
    RAISE EXCEPTION
      'CB21 add-ons preflight failed: expected 3 canonical tariff mappings, got %',
      (SELECT count(*) FROM _cb21_tariff_map);
  END IF;
END
$$;

CREATE TEMP TABLE _cb21_offer_map (
  source_offer_id uuid PRIMARY KEY,
  target_offer_id uuid UNIQUE NOT NULL,
  source_tariff_id uuid NOT NULL,
  target_tariff_id uuid NOT NULL,
  offer_key text NOT NULL,
  discounted boolean NOT NULL,
  UNIQUE (target_tariff_id, offer_key)
) ON COMMIT DROP;

WITH source_offers AS (
  SELECT
    offers.id,
    offers.tariff_id,
    CASE
      WHEN offers.offer_type = 'pay_now'
       AND offers.payment_method = 'full_payment' THEN 'card'
      WHEN offers.offer_type = 'pay_now'
       AND offers.payment_method = 'internal_installment' THEN 'two_payments'
      WHEN offers.offer_type = 'invoice' THEN 'invoice'
      WHEN offers.offer_type = 'bank_installment' THEN 'bank_installment'
    END AS offer_key
  FROM public.tariff_offers offers
  JOIN _cb21_tariff_map mapping
    ON mapping.source_tariff_id = offers.tariff_id
  WHERE offers.is_active IS TRUE
),
target_offers AS (
  SELECT
    offers.id,
    offers.tariff_id,
    CASE
      WHEN offers.offer_type = 'pay_now'
       AND offers.payment_method = 'full_payment' THEN 'card'
      WHEN offers.offer_type = 'pay_now'
       AND offers.payment_method = 'internal_installment' THEN 'two_payments'
      WHEN offers.offer_type = 'invoice' THEN 'invoice'
      WHEN offers.offer_type = 'bank_installment' THEN 'bank_installment'
    END AS offer_key
  FROM public.tariff_offers offers
  JOIN _cb21_tariff_map mapping
    ON mapping.target_tariff_id = offers.tariff_id
  WHERE offers.is_active IS TRUE
)
INSERT INTO _cb21_offer_map (
  source_offer_id,
  target_offer_id,
  source_tariff_id,
  target_tariff_id,
  offer_key,
  discounted
)
SELECT
  source_offer.id,
  target_offer.id,
  mapping.source_tariff_id,
  mapping.target_tariff_id,
  source_offer.offer_key,
  mapping.discounted
FROM _cb21_tariff_map mapping
JOIN source_offers source_offer
  ON source_offer.tariff_id = mapping.source_tariff_id
JOIN target_offers target_offer
  ON target_offer.tariff_id = mapping.target_tariff_id
 AND target_offer.offer_key = source_offer.offer_key
WHERE source_offer.offer_key IS NOT NULL
  AND target_offer.offer_key IS NOT NULL;

DO $$
DECLARE
  bad_tariffs text;
BEGIN
  SELECT string_agg(mapping.source_public_id || '→' || mapping.target_public_id, ', ')
    INTO bad_tariffs
  FROM _cb21_tariff_map mapping
  WHERE (
    SELECT count(*)
    FROM public.tariff_offers offers
    WHERE offers.tariff_id = mapping.source_tariff_id
      AND offers.is_active IS TRUE
  ) <> 4
     OR (
       SELECT count(DISTINCT offer_map.offer_key)
       FROM _cb21_offer_map offer_map
       WHERE offer_map.source_tariff_id = mapping.source_tariff_id
     ) <> 4
     OR (
       SELECT count(*)
       FROM public.tariff_offers offers
       WHERE offers.tariff_id = mapping.target_tariff_id
         AND offers.is_active IS TRUE
     ) <> 4
     OR (
       SELECT count(DISTINCT offer_map.offer_key)
       FROM _cb21_offer_map offer_map
       WHERE offer_map.target_tariff_id = mapping.target_tariff_id
     ) <> 4;

  IF bad_tariffs IS NOT NULL THEN
    RAISE EXCEPTION
      'CB21 add-ons preflight failed: source/target offers are not an exact 4-flow matrix for %',
      bad_tariffs;
  END IF;

  IF (SELECT count(*) FROM _cb21_offer_map) <> 12 THEN
    RAISE EXCEPTION
      'CB21 add-ons preflight failed: expected 12 semantic offer mappings, got %',
      (SELECT count(*) FROM _cb21_offer_map);
  END IF;
END
$$;

DO $$
DECLARE
  bad_source text;
BEGIN
  SELECT string_agg(mapping.source_public_id, ', ')
    INTO bad_source
  FROM _cb21_tariff_map mapping
  WHERE (
    SELECT count(*)
    FROM public.offer_addons addons
    JOIN public.tariff_offers parent_offer
      ON parent_offer.id = addons.parent_offer_id
    WHERE parent_offer.tariff_id = mapping.source_tariff_id
      AND addons.is_active IS TRUE
  ) <> 36
     OR (
       SELECT count(DISTINCT addons.addon_product_id)
       FROM public.offer_addons addons
       JOIN public.tariff_offers parent_offer
         ON parent_offer.id = addons.parent_offer_id
       WHERE parent_offer.tariff_id = mapping.source_tariff_id
         AND addons.is_active IS TRUE
     ) <> 9
     OR (
       SELECT count(*)
       FROM public.offer_addons addons
       JOIN public.tariff_offers parent_offer
         ON parent_offer.id = addons.parent_offer_id
       WHERE parent_offer.tariff_id = mapping.source_tariff_id
         AND addons.is_active IS TRUE
         AND (
           CASE
             WHEN mapping.discounted THEN
               addons.pricing_mode <> 'percent_discount'
               OR addons.discount_percent IS DISTINCT FROM 50::numeric
             ELSE
               addons.pricing_mode <> 'offer_price'
               OR addons.discount_percent IS NOT NULL
           END
         )
     ) <> 0;

  -- Delivery settings are administrator-configured and must be copied from
  -- the verified source matrix verbatim. CB20 currently uses `manual`; do not
  -- hard-code a different mode here or mutate the working source product.

  IF bad_source IS NOT NULL THEN
    RAISE EXCEPTION
      'CB21 add-ons preflight failed: verified CB20 matrix drifted for %',
      bad_source;
  END IF;
END
$$;

-- Preserve history but deactivate unexpected live CB21 links before the exact
-- source matrix is upserted. Nothing is deleted.
UPDATE public.offer_addons target_addon
SET is_active = false,
    updated_at = now()
WHERE target_addon.parent_offer_id IN (
  SELECT target_offer_id FROM _cb21_offer_map
)
AND NOT EXISTS (
  SELECT 1
  FROM _cb21_offer_map offer_map
  JOIN public.offer_addons source_addon
    ON source_addon.parent_offer_id = offer_map.source_offer_id
   AND source_addon.addon_offer_id = target_addon.addon_offer_id
   AND source_addon.is_active IS TRUE
  WHERE offer_map.target_offer_id = target_addon.parent_offer_id
);

INSERT INTO public.offer_addons (
  parent_offer_id,
  addon_product_id,
  addon_tariff_id,
  addon_offer_id,
  pricing_mode,
  fixed_amount,
  discount_percent,
  is_required,
  is_default_selected,
  allow_repurchase_after_expiry,
  sort_order,
  is_active,
  visible_from,
  visible_to,
  meta,
  access_delivery_mode,
  access_opens_at,
  access_duration_days
)
SELECT
  offer_map.target_offer_id,
  source_addon.addon_product_id,
  source_addon.addon_tariff_id,
  source_addon.addon_offer_id,
  source_addon.pricing_mode,
  source_addon.fixed_amount,
  source_addon.discount_percent,
  source_addon.is_required,
  source_addon.is_default_selected,
  source_addon.allow_repurchase_after_expiry,
  source_addon.sort_order,
  true,
  source_addon.visible_from,
  source_addon.visible_to,
  source_addon.meta,
  source_addon.access_delivery_mode,
  source_addon.access_opens_at,
  source_addon.access_duration_days
FROM _cb21_offer_map offer_map
JOIN public.offer_addons source_addon
  ON source_addon.parent_offer_id = offer_map.source_offer_id
 AND source_addon.is_active IS TRUE
ON CONFLICT (parent_offer_id, addon_offer_id)
DO UPDATE SET
  addon_product_id = EXCLUDED.addon_product_id,
  addon_tariff_id = EXCLUDED.addon_tariff_id,
  pricing_mode = EXCLUDED.pricing_mode,
  fixed_amount = EXCLUDED.fixed_amount,
  discount_percent = EXCLUDED.discount_percent,
  is_required = EXCLUDED.is_required,
  is_default_selected = EXCLUDED.is_default_selected,
  allow_repurchase_after_expiry = EXCLUDED.allow_repurchase_after_expiry,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  visible_from = EXCLUDED.visible_from,
  visible_to = EXCLUDED.visible_to,
  meta = EXCLUDED.meta,
  access_delivery_mode = EXCLUDED.access_delivery_mode,
  access_opens_at = EXCLUDED.access_opens_at,
  access_duration_days = EXCLUDED.access_duration_days,
  updated_at = now();

DO $$
DECLARE
  bad_target text;
BEGIN
  SELECT string_agg(mapping.target_public_id, ', ')
    INTO bad_target
  FROM _cb21_tariff_map mapping
  WHERE (
    SELECT count(*)
    FROM public.offer_addons addons
    JOIN public.tariff_offers parent_offer
      ON parent_offer.id = addons.parent_offer_id
    WHERE parent_offer.tariff_id = mapping.target_tariff_id
      AND addons.is_active IS TRUE
  ) <> 36
     OR (
       SELECT count(DISTINCT addons.addon_product_id)
       FROM public.offer_addons addons
       JOIN public.tariff_offers parent_offer
         ON parent_offer.id = addons.parent_offer_id
       WHERE parent_offer.tariff_id = mapping.target_tariff_id
         AND addons.is_active IS TRUE
     ) <> 9
     OR (
       SELECT count(*)
       FROM public.offer_addons addons
       JOIN public.tariff_offers parent_offer
         ON parent_offer.id = addons.parent_offer_id
       WHERE parent_offer.tariff_id = mapping.target_tariff_id
         AND addons.is_active IS TRUE
         AND (
           CASE
             WHEN mapping.discounted THEN
               addons.pricing_mode <> 'percent_discount'
               OR addons.discount_percent IS DISTINCT FROM 50::numeric
             ELSE
               addons.pricing_mode <> 'offer_price'
               OR addons.discount_percent IS NOT NULL
           END
         )
     ) <> 0
     OR (
       SELECT count(*)
       FROM _cb21_offer_map offer_map
       JOIN public.offer_addons source_addon
         ON source_addon.parent_offer_id = offer_map.source_offer_id
        AND source_addon.is_active IS TRUE
       JOIN public.offer_addons target_addon
         ON target_addon.parent_offer_id = offer_map.target_offer_id
        AND target_addon.addon_offer_id = source_addon.addon_offer_id
        AND target_addon.is_active IS TRUE
       WHERE offer_map.target_tariff_id = mapping.target_tariff_id
         AND (
           target_addon.access_delivery_mode IS DISTINCT FROM source_addon.access_delivery_mode
           OR target_addon.access_opens_at IS DISTINCT FROM source_addon.access_opens_at
           OR target_addon.access_duration_days IS DISTINCT FROM source_addon.access_duration_days
         )
     ) <> 0;

  IF bad_target IS NOT NULL THEN
    RAISE EXCEPTION
      'CB21 add-ons read-back failed: target matrix is not exact for %',
      bad_target;
  END IF;
END
$$;

COMMIT;