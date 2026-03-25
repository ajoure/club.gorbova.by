
-- S4-INTERNAL-TEMPLATE-EDITOR Phase 1: Add editor columns to document_templates
-- template_status: draft | approved | in_development
-- editor_mvp_enabled: boolean flag for editor availability
-- editor_draft_content: JSONB staging-only field, NOT used by runtime generation

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS template_status text NOT NULL DEFAULT 'in_development',
  ADD COLUMN IF NOT EXISTS editor_mvp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS editor_draft_content jsonb DEFAULT NULL;

COMMENT ON COLUMN public.document_templates.editor_draft_content IS 'Staging only — editor draft content. NOT used by runtime DOCX generation. See S4-EDITOR-DRAFT-TO-DOCX-EXPORT for future export path.';
COMMENT ON COLUMN public.document_templates.template_status IS 'Template lifecycle status: draft, approved, in_development';
COMMENT ON COLUMN public.document_templates.editor_mvp_enabled IS 'Whether the visual editor is available for this template (MVP feature flag)';
