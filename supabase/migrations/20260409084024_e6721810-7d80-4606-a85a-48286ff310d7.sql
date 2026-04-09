
-- 1. Add marketing fields to app_sections
ALTER TABLE public.app_sections
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS features_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cta_label text;

-- 2. Populate data for the 'ai' section
UPDATE public.app_sections
SET
  short_description = 'AI-помощник для бизнеса и бухгалтерии',
  features_json = '["Общение с AI-помощником", "Помощь по бухгалтерским и юридическим вопросам", "Подготовка и анализ документов", "Ускорение рутинных задач"]'::jsonb,
  cta_label = 'Получить доступ'
WHERE code = 'ai';

-- 3. Create RPC: get_section_access_catalog
-- Returns section info + ALL active access rules for a given section
CREATE OR REPLACE FUNCTION public.get_section_access_catalog(p_section_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section record;
  v_rules jsonb;
BEGIN
  -- Get section info
  SELECT id, code, label, short_description, features_json, cta_label, is_active, is_public
  INTO v_section
  FROM public.app_sections
  WHERE code = p_section_code;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Get ALL active access rules for this section
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rule_id', ar.id,
      'product_id', ar.product_id,
      'product_name', p.name,
      'product_slug', p.slug,
      'tariff_id', ar.tariff_id,
      'tariff_name', t.name,
      'tariff_public_id', t.public_id,
      'target_label', ar.target_label
    ) ORDER BY ar.priority
  ), '[]'::jsonb)
  INTO v_rules
  FROM public.access_rules ar
  LEFT JOIN public.products_v2 p ON p.id = ar.product_id
  LEFT JOIN public.tariffs t ON t.id = ar.tariff_id
  WHERE ar.grant_target_type = 'section_access'
    AND ar.target_ref = v_section.id::text
    AND ar.is_active = true;

  RETURN jsonb_build_object(
    'section_code', v_section.code,
    'section_label', v_section.label,
    'short_description', v_section.short_description,
    'features_json', v_section.features_json,
    'cta_label', v_section.cta_label,
    'is_active', v_section.is_active,
    'is_public', v_section.is_public,
    'available_via_rules', v_rules
  );
END;
$$;
