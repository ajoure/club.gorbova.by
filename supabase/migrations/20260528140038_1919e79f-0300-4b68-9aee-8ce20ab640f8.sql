-- Sprint 3F §E: Custom roles per package — добавляем стабильный public_id PKR-XXXXXX + is_system flag
-- к существующей таблице document_package_role_catalog.
-- Никаких новых таблиц. RLS уже настроен (admin/super_admin owner-path).

-- 1) sequence для PKR
CREATE SEQUENCE IF NOT EXISTS public.document_package_role_public_id_seq START 1 INCREMENT 1;

-- 2) колонки
ALTER TABLE public.document_package_role_catalog
  ADD COLUMN IF NOT EXISTS public_id text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS output_template text;
-- output_template: формат вывода роли при резолве {{package.role.PKR-XXXXXX}}.
-- По умолчанию (NULL) резолвер использует "{{position}}, {{full_name}}".
-- Хранится как plain text с токенами {{full_name}}, {{short_name}}, {{position}}.

COMMENT ON COLUMN public.document_package_role_catalog.public_id
  IS 'Стабильный публичный ID роли (PKR-XXXXXX) для использования в Word-плейсхолдерах {{package.role.PKR-XXXXXX}}. Не изменяется при переименовании роли.';
COMMENT ON COLUMN public.document_package_role_catalog.is_system
  IS 'true для системных ролей (защита от удаления и переименования role_key). false для custom-ролей, созданных администратором.';
COMMENT ON COLUMN public.document_package_role_catalog.output_template
  IS 'Шаблон вывода роли при резолве {{package.role.PKR-XXXXXX}}. NULL = дефолт "{{position}}, {{full_name}}". Разрешены токены: {{full_name}}, {{short_name}}, {{position}}.';

-- 3) trigger автоприсвоения public_id
CREATE OR REPLACE FUNCTION public.assign_package_role_public_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_n bigint;
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    next_n := nextval('public.document_package_role_public_id_seq');
    NEW.public_id := 'PKR-' || LPAD(next_n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_package_role_catalog_public_id ON public.document_package_role_catalog;
CREATE TRIGGER trg_document_package_role_catalog_public_id
  BEFORE INSERT ON public.document_package_role_catalog
  FOR EACH ROW EXECUTE FUNCTION public.assign_package_role_public_id();

-- 4) backfill 11 существующих системных ролей пакета «Идеология» по sort_order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, created_at) AS rn
  FROM public.document_package_role_catalog
  WHERE public_id IS NULL
)
UPDATE public.document_package_role_catalog c
SET
  public_id = 'PKR-' || LPAD(o.rn::text, 6, '0'),
  is_system = true
FROM ordered o
WHERE c.id = o.id;

-- 5) advance sequence past max
SELECT setval(
  'public.document_package_role_public_id_seq',
  GREATEST(
    1,
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(public_id, '^PKR-', ''), '')::int), 0) FROM public.document_package_role_catalog)
  )
);

-- 6) уникальный индекс
ALTER TABLE public.document_package_role_catalog
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_package_role_catalog_public_id
  ON public.document_package_role_catalog (public_id);

-- 7) partial unique для role_key per package_template (для custom-роли проверка дублей)
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_package_role_catalog_pkg_rolekey_active
  ON public.document_package_role_catalog (package_template_id, role_key)
  WHERE is_active = true;