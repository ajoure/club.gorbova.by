ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_document_templates_active ON public.document_templates(id) WHERE deleted_at IS NULL;
COMMENT ON COLUMN public.document_templates.deleted_at IS 'Soft-delete timestamp; NULL = active. Set via UI archive action; never hard-delete production templates.';