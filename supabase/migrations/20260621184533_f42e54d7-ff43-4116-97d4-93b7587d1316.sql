ALTER TABLE public.document_package_template_items
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_dptem_metadata_gin
  ON public.document_package_template_items USING gin (metadata);

COMMENT ON COLUMN public.document_package_template_items.metadata IS
  'Per-item конфиг. v1: metadata.table_repeats[] — повторяемые строки таблицы DOCX по роли (маркер {{tableRepeat:TR-XXXXXX}}). PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1.';