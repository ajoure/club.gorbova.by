-- ЦБ20/ЦБ21 получают два independently switchable section_access rules per
-- tariff. The existing admin "Access Rules" screen remains the source of
-- truth: this migration never changes, broadens or reactivates an old rule.
--
-- The product ids identify the two canonical flows, while the actual access
-- decision continues to be made by user_has_access_to_rule (subscription
-- status + access_end_at + exact tariff) at request time.

DO $$
DECLARE
  v_section_count integer;
  v_cb20_tariff_count integer;
  v_cb21_tariff_count integer;
BEGIN
  SELECT count(*)
    INTO v_section_count
  FROM public.app_sections
  WHERE code IN ('ai_asset_classifier', 'ai_bank_statement_analysis')
    AND is_active = true;

  IF v_section_count <> 2 THEN
    RAISE EXCEPTION 'cb_ai_tools_sections_not_ready: expected 2 active sections, got %', v_section_count;
  END IF;

  SELECT count(*)
    INTO v_cb20_tariff_count
  FROM public.tariffs
  WHERE product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid; -- ЦБ20

  SELECT count(*)
    INTO v_cb21_tariff_count
  FROM public.tariffs
  WHERE product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid; -- ЦБ21

  -- The canonical product ids are the access boundary. Grant every tariff
  -- identifier currently used by each flow: hidden, gift and historic tariff
  -- records may still belong to a valid paid subscription. Runtime access is
  -- still restricted by user_has_access_to_rule (status, expiry and tariff).
  IF v_cb20_tariff_count = 0 OR v_cb21_tariff_count = 0 THEN
    RAISE EXCEPTION 'cb_ai_tools_tariff_scope_missing: expected tariffs for both CB20 and CB21, got cb20=% cb21=%', v_cb20_tariff_count, v_cb21_tariff_count;
  END IF;
END;
$$;

WITH target_tariffs AS (
  SELECT
    tariff.id AS tariff_id,
    tariff.product_id,
    product.name AS product_name,
    tariff.name AS tariff_name
  FROM public.tariffs tariff
  JOIN public.products_v2 product ON product.id = tariff.product_id
  WHERE tariff.product_id IN (
    '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
    '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid
  )
), target_sections AS (
  SELECT id, label
  FROM public.app_sections
  WHERE code IN ('ai_asset_classifier', 'ai_bank_statement_analysis')
    AND is_active = true
)
INSERT INTO public.access_rules (
  product_id,
  tariff_id,
  grant_target_type,
  target_ref,
  target_label,
  is_active,
  priority,
  conditions,
  notes
)
SELECT
  tariff.product_id,
  tariff.tariff_id,
  'section_access',
  section.id::text,
  section.label,
  true,
  30,
  jsonb_build_object('rule_purpose', 'service', 'source', 'cb_ai_tools_tariff_access'),
  format('ЦБ AI-инструмент: %s — %s', tariff.product_name, tariff.tariff_name)
FROM target_tariffs tariff
CROSS JOIN target_sections section
WHERE NOT EXISTS (
  SELECT 1
  FROM public.access_rules existing
  WHERE existing.product_id = tariff.product_id
    AND existing.tariff_id = tariff.tariff_id
    AND existing.grant_target_type = 'section_access'
    AND existing.target_ref = section.id::text
);