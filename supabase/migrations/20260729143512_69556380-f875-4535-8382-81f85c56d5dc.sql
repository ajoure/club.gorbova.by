-- Deterministic fixed-asset classifier based on the consolidated Appendix to
-- Resolution of the Ministry of Economy of Belarus No. 161.

INSERT INTO public.app_sections (
  code,
  label,
  icon,
  route,
  is_public,
  sort_order,
  is_active
)
VALUES (
  'ai_asset_classifier',
  'AI: Определение шифра ОС',
  'SearchCheck',
  '/ai?sub=chat&scenario=asset_classifier',
  false,
  45,
  true
)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  is_public = EXCLUDED.is_public,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO public.ai_user_prompts (
  code,
  title,
  description,
  prompt_text,
  type,
  category,
  icon,
  input_hint,
  is_active,
  is_archived,
  sort_order,
  is_visible_in_chat,
  launcher_title,
  launcher_description,
  launcher_order
)
VALUES (
  'asset_classifier',
  'Определение шифра основных средств',
  'Детерминированный подбор позиции по постановлению Министерства экономики Республики Беларусь № 161.',
  'SYSTEM: deterministic lookup; no language model is invoked.',
  'text_transform',
  'Основные средства',
  'SearchCheck',
  'Опишите объект: наименование, модель, назначение и ключевые характеристики.',
  true,
  false,
  30,
  true,
  'Определение шифра ОС',
  'Подбирает шифр и нормативный срок службы по постановлению № 161 без использования AI.',
  30
)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  prompt_text = EXCLUDED.prompt_text,
  type = EXCLUDED.type,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  input_hint = EXCLUDED.input_hint,
  is_active = EXCLUDED.is_active,
  is_archived = EXCLUDED.is_archived,
  sort_order = EXCLUDED.sort_order,
  is_visible_in_chat = EXCLUDED.is_visible_in_chat,
  launcher_title = EXCLUDED.launcher_title,
  launcher_description = EXCLUDED.launcher_description,
  launcher_order = EXCLUDED.launcher_order;

-- Preserve the current full-AI product behavior while making the service an
-- independently assignable product/tariff capability in Product Access Rules.
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
  product.id,
  NULL,
  'section_access',
  section.id::text,
  section.label,
  true,
  30,
  '{"rule_purpose":"service"}'::jsonb,
  'Initial access to deterministic fixed-asset classifier'
FROM public.products_v2 product
CROSS JOIN public.app_sections section
WHERE product.id IN (
  '11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid,
  '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid
)
  AND section.code = 'ai_asset_classifier'
  AND NOT EXISTS (
    SELECT 1
    FROM public.access_rules existing
    WHERE existing.product_id = product.id
      AND existing.tariff_id IS NULL
      AND existing.grant_target_type = 'section_access'
      AND existing.target_ref = section.id::text
  );