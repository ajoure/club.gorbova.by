
-- Sprint 2: token validation fields on document_template_versions (add-only, nullable)
ALTER TABLE public.document_template_versions
  ADD COLUMN IF NOT EXISTS detected_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS token_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_status text,
  ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_checked_at timestamptz;

-- mapped/unmapped/missing required counters live in token_manifest; status is denormalised.
-- Allowed values: 'valid' | 'valid_with_warnings' | 'invalid_unknown_required' | 'unchecked'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_template_versions_validation_status_check') THEN
    ALTER TABLE public.document_template_versions
      ADD CONSTRAINT document_template_versions_validation_status_check
      CHECK (validation_status IS NULL OR validation_status IN ('valid','valid_with_warnings','invalid_unknown_required','unchecked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_doc_tpl_versions_validation
  ON public.document_template_versions (template_id, validation_status);
