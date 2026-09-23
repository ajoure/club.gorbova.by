-- Dedicated CB AI tool. Its runtime authorization is resolved through the
-- existing app_sections/access_rules model and remains editable in the admin UI.
INSERT INTO public.app_sections (
  code, label, icon, route, is_public, sort_order, is_active
)
VALUES (
  'ai_act_reconciliation',
  'AI: Сверка актов',
  'FilesDiff',
  '/ai?sub=chat&scenario=act_reconciliation',
  false,
  47,
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
  code, title, description, prompt_text, type, category, icon, input_hint,
  is_active, is_archived, sort_order, is_visible_in_chat, launcher_title,
  launcher_description, launcher_order
)
VALUES (
  'act_reconciliation',
  'Сверка актов',
  'Сравнение двух актов сверки, отчёт по расхождениям и проект письма контрагенту.',
  'SYSTEM: dedicated act reconciliation analyzer; no generic chat routing.',
  'file_analysis',
  'Проверки',
  'FilesDiff',
  'Загрузите ровно два файла: сначала акт вашей организации, затем акт контрагента.',
  true,
  false,
  32,
  true,
  'Сверка актов',
  'ИИ сравнит два акта, покажет конкретные расхождения и подготовит письмо контрагенту.',
  32
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

DO $$
DECLARE
  v_section_count integer;
  v_cb20_tariff_count integer;
  v_cb21_tariff_count integer;
BEGIN
  SELECT count(*) INTO v_section_count
  FROM public.app_sections
  WHERE code = 'ai_act_reconciliation' AND is_active = true;

  SELECT count(*) INTO v_cb20_tariff_count
  FROM public.tariffs
  WHERE product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid;

  SELECT count(*) INTO v_cb21_tariff_count
  FROM public.tariffs
  WHERE product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid;

  IF v_section_count <> 1 THEN
    RAISE EXCEPTION 'act_reconciliation_section_not_ready: expected 1 active section, got %', v_section_count;
  END IF;
  IF v_cb20_tariff_count = 0 OR v_cb21_tariff_count = 0 THEN
    RAISE EXCEPTION 'act_reconciliation_tariff_scope_missing: cb20=% cb21=%', v_cb20_tariff_count, v_cb21_tariff_count;
  END IF;
END;
$$;

WITH target_tariffs AS (
  SELECT tariff.id AS tariff_id, tariff.product_id, product.name AS product_name, tariff.name AS tariff_name
  FROM public.tariffs tariff
  JOIN public.products_v2 product ON product.id = tariff.product_id
  WHERE tariff.product_id IN (
    '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
    '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid
  )
), target_section AS (
  SELECT id, label
  FROM public.app_sections
  WHERE code = 'ai_act_reconciliation' AND is_active = true
)
INSERT INTO public.access_rules (
  product_id, tariff_id, grant_target_type, target_ref, target_label,
  is_active, priority, conditions, notes
)
SELECT
  tariff.product_id,
  tariff.tariff_id,
  'section_access',
  section.id::text,
  section.label,
  true,
  30,
  jsonb_build_object('rule_purpose', 'service', 'source', 'cb_act_reconciliation_tariff_access'),
  format('ЦБ AI-инструмент: %s — %s', tariff.product_name, tariff.tariff_name)
FROM target_tariffs tariff
CROSS JOIN target_section section
WHERE NOT EXISTS (
  SELECT 1
  FROM public.access_rules existing
  WHERE existing.product_id = tariff.product_id
    AND existing.tariff_id = tariff.tariff_id
    AND existing.grant_target_type = 'section_access'
    AND existing.target_ref = section.id::text
);