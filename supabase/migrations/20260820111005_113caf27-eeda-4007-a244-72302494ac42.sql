WITH RECURSIVE t AS (
  SELECT m.id FROM public.training_modules m WHERE m.id = '4365e913-36f1-432e-ab16-748c3ca6826a'
  UNION ALL
  SELECT c.id FROM public.training_modules c JOIN t ON c.parent_module_id = t.id
)
UPDATE public.training_modules m
SET title = regexp_replace(m.title, '^Копия — ', ''),
    product_id = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596',
    updated_at = now()
FROM t WHERE m.id = t.id;

WITH RECURSIVE t AS (
  SELECT m.id FROM public.training_modules m WHERE m.id = '4365e913-36f1-432e-ab16-748c3ca6826a'
  UNION ALL
  SELECT c.id FROM public.training_modules c JOIN t ON c.parent_module_id = t.id
)
UPDATE public.training_lessons l
SET title = regexp_replace(l.title, '^Копия — ', ''),
    updated_at = now()
WHERE l.module_id IN (SELECT id FROM t) AND l.title LIKE 'Копия — %';

UPDATE public.training_modules
SET title = 'Ценный бухгалтер | 1 ступень 2.0 | 21 поток', updated_at = now()
WHERE id = '4365e913-36f1-432e-ab16-748c3ca6826a';