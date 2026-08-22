-- Configure delayed add-on delivery for exactly one product. The purchase stays
-- visible through scheduled_product_access; no entitlement is created or
-- revoked by this migration.
DO $migration$
DECLARE
  v_product_id constant uuid := '3e43fb28-8322-41bc-bfee-714731bdc630';
  v_opens_at constant timestamptz := '2026-09-30T21:00:00Z';
  v_offer_addons integer;
  v_parent_offers integer;
  v_modules integer;
  v_tariffs integer;
  v_scheduled integer;
BEGIN
  SELECT count(*), count(DISTINCT oa.parent_offer_id),
         count(DISTINCT oa.addon_product_id), count(DISTINCT t.id)
    INTO v_offer_addons, v_parent_offers, v_modules, v_tariffs
  FROM public.offer_addons oa
  JOIN public.tariff_offers parent_offer ON parent_offer.id = oa.parent_offer_id
  JOIN public.tariffs t ON t.id = parent_offer.tariff_id
  WHERE t.product_id = v_product_id
    AND t.code IN ('T-000076', 'T-000077', 'T-000078')
    AND oa.is_active;

  IF (v_offer_addons, v_parent_offers, v_modules, v_tariffs) IS DISTINCT FROM
     (108, 12, 9, 3) THEN
    RAISE EXCEPTION
      'prd_000039_addon_preflight_mismatch: links=%, offers=%, modules=%, tariffs=%',
      v_offer_addons, v_parent_offers, v_modules, v_tariffs;
  END IF;

  UPDATE public.offer_addons oa
  SET access_delivery_mode = 'fixed_date',
      access_opens_at = v_opens_at,
      updated_at = now()
  FROM public.tariff_offers parent_offer
  JOIN public.tariffs t ON t.id = parent_offer.tariff_id
  WHERE oa.parent_offer_id = parent_offer.id
    AND t.product_id = v_product_id
    AND t.code IN ('T-000076', 'T-000077', 'T-000078')
    AND oa.is_active;

  GET DIAGNOSTICS v_offer_addons = ROW_COUNT;
  IF v_offer_addons <> 108 THEN
    RAISE EXCEPTION 'prd_000039_addon_update_mismatch: %', v_offer_addons;
  END IF;

  UPDATE public.scheduled_product_access spa
  SET access_delivery_mode = 'fixed_date',
      opens_at = v_opens_at,
      updated_at = now(),
      access_snapshot = spa.access_snapshot || jsonb_build_object(
        'access_delivery_mode', 'fixed_date',
        'access_opens_at', v_opens_at
      )
  FROM public.order_group_items addon_item
  JOIN public.order_groups og ON og.id = addon_item.order_group_id
  JOIN public.order_group_items primary_item
    ON primary_item.order_group_id = og.id AND primary_item.role = 'primary'
  JOIN public.tariffs primary_tariff ON primary_tariff.id = primary_item.tariff_id
  JOIN public.offer_addons oa
    ON oa.parent_offer_id = primary_item.offer_id
   AND oa.addon_offer_id = addon_item.offer_id
   AND oa.addon_product_id = addon_item.product_id
   AND oa.is_active
  WHERE spa.order_group_item_id = addon_item.id
    AND addon_item.role = 'addon'
    AND primary_tariff.product_id = v_product_id
    AND primary_tariff.code IN ('T-000076', 'T-000077', 'T-000078')
    AND spa.status = 'scheduled';

  GET DIAGNOSTICS v_scheduled = ROW_COUNT;
  IF v_scheduled <> 4 THEN
    RAISE EXCEPTION 'prd_000039_scheduled_update_mismatch: %', v_scheduled;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.offer_addons oa
    JOIN public.tariff_offers parent_offer ON parent_offer.id = oa.parent_offer_id
    JOIN public.tariffs t ON t.id = parent_offer.tariff_id
    WHERE oa.access_opens_at = v_opens_at
      AND t.product_id <> v_product_id
  ) THEN
    RAISE EXCEPTION 'prd_000039_cross_product_write_detected';
  END IF;
END
$migration$;
