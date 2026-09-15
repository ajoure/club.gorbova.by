-- ЦБ-1 получает дополнительный доступ к уже работающему сервису
-- «Определение шифра ОС». Существующие правила для других продуктов не
-- меняем: это add-only grant.
DO $migration$
DECLARE
  v_product_id uuid;
  v_section_id uuid;
BEGIN
  SELECT id
    INTO v_product_id
    FROM public.products_v2
   WHERE code = 'cb20'
   LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'CB product with code cb20 was not found';
  END IF;

  SELECT id
    INTO v_section_id
    FROM public.app_sections
   WHERE code = 'ai_asset_classifier'
     AND is_active = true
   LIMIT 1;

  IF v_section_id IS NULL THEN
    RAISE EXCEPTION 'Active AI asset-classifier section was not found';
  END IF;

  UPDATE public.access_rules
     SET is_active = true,
         target_label = 'AI: Определение шифра ОС',
         priority = 30,
         conditions = '{"rule_purpose":"service"}'::jsonb,
         notes = 'CB-1 access to the existing asset-classifier; existing product grants remain unchanged'
   WHERE product_id = v_product_id
     AND tariff_id IS NULL
     AND grant_target_type = 'section_access'
     AND target_ref = v_section_id::text;

  IF NOT FOUND THEN
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
    ) VALUES (
      v_product_id,
      NULL,
      'section_access',
      v_section_id::text,
      'AI: Определение шифра ОС',
      true,
      30,
      '{"rule_purpose":"service"}'::jsonb,
      'CB-1 access to the existing asset-classifier; existing product grants remain unchanged'
    );
  END IF;
END
$migration$;
