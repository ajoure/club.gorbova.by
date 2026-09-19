-- ЦБ20/ЦБ21 получают доступ только к входу в рабочее пространство
-- «Нейросеть». Само выполнение каждого AI-инструмента по-прежнему проверяется
-- его отдельным section_access rule и Edge Function, поэтому этот rule не
-- открывает свободный чат или любой сценарий без собственной покупки.
--
-- Rule хранится в обычной таблице access_rules, а не в коде: администратор
-- может увидеть и выключить его на существующем экране управления доступами.

DO $$
DECLARE
  v_ai_section_id uuid;
  v_cb20_tariff_count integer;
  v_cb21_tariff_count integer;
BEGIN
  SELECT id
    INTO v_ai_section_id
  FROM public.app_sections
  WHERE code = 'ai'
    AND is_active = true;

  IF v_ai_section_id IS NULL THEN
    RAISE EXCEPTION 'cb_ai_workspace_section_missing';
  END IF;

  SELECT count(*)
    INTO v_cb20_tariff_count
  FROM public.tariffs
  WHERE product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid; -- ЦБ20

  SELECT count(*)
    INTO v_cb21_tariff_count
  FROM public.tariffs
  WHERE product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid; -- ЦБ21

  IF v_cb20_tariff_count = 0 OR v_cb21_tariff_count = 0 THEN
    RAISE EXCEPTION 'cb_ai_workspace_tariff_scope_missing: cb20=%, cb21=%',
      v_cb20_tariff_count, v_cb21_tariff_count;
  END IF;
END;
$$;

WITH cb_tariffs AS (
  SELECT tariff.id AS tariff_id, tariff.product_id
  FROM public.tariffs tariff
  WHERE tariff.product_id IN (
    '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid,
    '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid
  )
), ai_workspace AS (
  SELECT id, label
  FROM public.app_sections
  WHERE code = 'ai'
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
  workspace.id::text,
  workspace.label,
  true,
  29,
  jsonb_build_object('rule_purpose', 'workspace_entry', 'source', 'cb_ai_tools_workspace_entry'),
  'ЦБ AI-инструменты: вход в Нейросеть; сценарии проверяются отдельными rules'
FROM cb_tariffs tariff
CROSS JOIN ai_workspace workspace
WHERE NOT EXISTS (
  SELECT 1
  FROM public.access_rules existing
  WHERE existing.product_id = tariff.product_id
    AND existing.tariff_id = tariff.tariff_id
    AND existing.grant_target_type = 'section_access'
    AND existing.target_ref = workspace.id::text
);
