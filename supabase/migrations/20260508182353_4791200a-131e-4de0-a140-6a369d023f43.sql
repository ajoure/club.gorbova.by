ALTER TABLE public.document_template_versions
  ADD COLUMN IF NOT EXISTS editor_html text,
  ADD COLUMN IF NOT EXISTS editor_json jsonb;

COMMENT ON COLUMN public.document_template_versions.editor_html IS
  'TipTap HTML preview (staging). DOCX in storage остаётся каноническим экспортом.';
COMMENT ON COLUMN public.document_template_versions.editor_json IS
  'TipTap JSON — source визуального редактора (Sprint 11 C4).';