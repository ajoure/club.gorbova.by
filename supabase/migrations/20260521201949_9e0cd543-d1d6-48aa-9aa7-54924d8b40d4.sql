-- PATCH-B: file_name_template SOT = document_templates (discovery подтвердил, что per-version не нужно).
-- Поле оставляется NULL для всех существующих шаблонов; production-шаблоны не модифицируются автоматически.
ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS file_name_template TEXT NULL;

COMMENT ON COLUMN public.document_templates.file_name_template IS
  'PATCH-B (FLD-first canon): шаблон имени файла для сгенерированных документов. Поддерживается только синтаксис {{field:FLD-XXXXXX}}. Должен содержать FLD-000069 (номер документа). NULL = использовать системный дефолт.';