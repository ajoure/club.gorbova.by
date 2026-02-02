-- PATCH-1A: Add provider and provider_token columns to card_profile_links
ALTER TABLE public.card_profile_links
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'bepaid',
  ADD COLUMN IF NOT EXISTS provider_token TEXT;

-- Partial unique index: only enforces uniqueness when token is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_profile_links_provider_token_unique
  ON public.card_profile_links (provider, provider_token)
  WHERE provider_token IS NOT NULL;

-- Regular index for lookups
CREATE INDEX IF NOT EXISTS idx_card_profile_links_provider_token
  ON public.card_profile_links (provider, provider_token)
  WHERE provider_token IS NOT NULL;