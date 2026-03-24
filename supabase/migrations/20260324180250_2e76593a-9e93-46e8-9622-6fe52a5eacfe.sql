-- PATCH 2.6A: Snapshot strategy columns for ai_generated_documents
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS token_manifest_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS template_tokens_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_trace jsonb,
  ADD COLUMN IF NOT EXISTS template_code text,
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS registry_version text,
  ADD COLUMN IF NOT EXISTS resolver_version text,
  ADD COLUMN IF NOT EXISTS warnings_snapshot jsonb;

-- PATCH 2.6B: Unified passport field for persons
ALTER TABLE public.legal_details_persons
  ADD COLUMN IF NOT EXISTS passport_number_full text;