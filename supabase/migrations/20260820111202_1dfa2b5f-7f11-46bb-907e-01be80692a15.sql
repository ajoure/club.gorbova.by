-- 1. Бизнес-леди 21: 300 дней
UPDATE public.tariffs SET access_days = 300, updated_at = now()
WHERE public_id = 'T-000086' AND access_days <> 300;

-- 2. Два внутренних тарифа 21 потока (idempotent по name+product)
INSERT INTO public.tariffs (product_id, code, name, access_days, is_active, is_public, meta, document_params)
SELECT '2b7bf6d4-ad8d-46ad-9399-7f96c307c596',
       'trf_' || substr(md5(random()::text || src.public_id), 1, 8) || '-' || substr(md5(random()::text), 1, 3),
       src.name, src.access_days, true, false, src.meta, src.document_params
FROM public.tariffs src
WHERE src.public_id IN ('T-000083','T-000084')
  AND NOT EXISTS (
    SELECT 1 FROM public.tariffs d
    WHERE d.product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
      AND btrim(d.name) = btrim(src.name)
  );

-- 3. Публичность: только 3 тарифа продукта 21
UPDATE public.tariffs SET is_public = (public_id IN ('T-000085','T-000086','T-000089')), updated_at = now()
WHERE product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
  AND is_public <> (public_id IN ('T-000085','T-000086','T-000089'));

-- 4. document_params для 3 публичных тарифов (merge, executor/templates/requisites сохраняются)
UPDATE public.tariffs t
SET document_params = coalesce(t.document_params, '{}'::jsonb) || jsonb_build_object(
      'payment_due_days', 3,
      'unit', 'доступ',
      'quantity', 1,
      'generate_act', true,
      'execution_days', t.access_days
    ),
    updated_at = now()
WHERE t.public_id IN ('T-000085','T-000086','T-000089');

-- 5. Перенос матрицы правил 20 -> 21
WITH RECURSIVE old_t AS (
  SELECT m.id, m.title, m.sort_order FROM public.training_modules m WHERE m.id = '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e'
  UNION ALL
  SELECT c.id, c.title, c.sort_order FROM public.training_modules c JOIN old_t ON c.parent_module_id = old_t.id
), new_t AS (
  SELECT m.id, m.title, m.sort_order FROM public.training_modules m WHERE m.id = '4365e913-36f1-432e-ab16-748c3ca6826a'
  UNION ALL
  SELECT c.id, c.title, c.sort_order FROM public.training_modules c JOIN new_t ON c.parent_module_id = new_t.id
), map AS (
  SELECT o.id AS old_id, n.id AS new_id
  FROM old_t o JOIN new_t n ON n.title = o.title AND n.sort_order = o.sort_order
  UNION ALL
  SELECT '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e'::uuid, '4365e913-36f1-432e-ab16-748c3ca6826a'::uuid
), tariff_map AS (
  SELECT s.id AS old_tid, d.id AS new_tid
  FROM public.tariffs s
  JOIN public.tariffs d ON d.product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
                       AND btrim(d.name) = btrim(s.name)
  WHERE s.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'
), src AS (
  SELECT r.*, tm.new_tid
  FROM public.access_rules r
  JOIN tariff_map tm ON tm.old_tid = r.tariff_id
  WHERE r.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630' AND r.is_active
), remapped AS (
  SELECT
    s.new_tid AS tariff_id,
    s.grant_target_type,
    CASE WHEN s.target_ref = '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e'
         THEN '4365e913-36f1-432e-ab16-748c3ca6826a' ELSE s.target_ref END AS target_ref,
    CASE WHEN s.target_ref = '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e'
         THEN 'Ценный бухгалтер | 1 ступень 2.0 | 21 поток' ELSE s.target_label END AS target_label,
    s.is_active, s.priority, s.duration_days, s.notes,
    CASE
      WHEN s.target_ref = '2e5cbc7b-bbaf-4384-b894-bbd98d7f524e'
       AND jsonb_typeof(s.conditions->'allowed_module_ids') = 'array'
      THEN jsonb_set(s.conditions, '{allowed_module_ids}', coalesce((
             SELECT jsonb_agg(to_jsonb(m.new_id::text))
             FROM jsonb_array_elements_text(s.conditions->'allowed_module_ids') e
             JOIN map m ON m.old_id = e::uuid
           ), '[]'::jsonb))
      ELSE s.conditions
    END AS conditions
  FROM src s
)
INSERT INTO public.access_rules (product_id, tariff_id, grant_target_type, target_ref, target_label, is_active, priority, duration_days, conditions, notes)
SELECT '2b7bf6d4-ad8d-46ad-9399-7f96c307c596', r.tariff_id, r.grant_target_type, r.target_ref, r.target_label,
       r.is_active, r.priority, r.duration_days, r.conditions, r.notes
FROM remapped r
WHERE NOT EXISTS (
  SELECT 1 FROM public.access_rules x
  WHERE x.product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
    AND x.tariff_id = r.tariff_id
    AND x.grant_target_type = r.grant_target_type
    AND x.target_ref = r.target_ref
);

-- 6. Привязка публичной страницы /cb к продукту 21
UPDATE public.site_pages SET product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596', updated_at = now()
WHERE public_id = 'SITE-000021' AND product_id IS DISTINCT FROM '2b7bf6d4-ad8d-46ad-9399-7f96c307c596';