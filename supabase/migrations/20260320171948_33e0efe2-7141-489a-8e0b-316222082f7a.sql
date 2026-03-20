
-- Add canonical JSONB shadow fields for structured address storage
-- Add-only migration: no removal or rename of existing fields

ALTER TABLE public.client_legal_details
  ADD COLUMN IF NOT EXISTS ind_address_structured JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ent_address_structured JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leg_address_structured JSONB DEFAULT NULL;

COMMENT ON COLUMN public.client_legal_details.ind_address_structured IS 'Canonical StructuredAddress (JSONB) for individual — replaces legacy ind_address_* fields as source of truth';
COMMENT ON COLUMN public.client_legal_details.ent_address_structured IS 'Canonical StructuredAddress (JSONB) for entrepreneur — legacy ent_address becomes derived';
COMMENT ON COLUMN public.client_legal_details.leg_address_structured IS 'Canonical StructuredAddress (JSONB) for legal entity — legacy leg_address becomes derived';

ALTER TABLE public.executors
  ADD COLUMN IF NOT EXISTS legal_address_structured JSONB DEFAULT NULL;

COMMENT ON COLUMN public.executors.legal_address_structured IS 'Canonical StructuredAddress (JSONB) — legacy legal_address becomes derived';
