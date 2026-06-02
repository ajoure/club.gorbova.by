-- Phase 1 Stripe Integration: extend payment_links (add-only, no enum)

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'bepaid',
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS account_code text NULL,
  ADD COLUMN IF NOT EXISTS profile_code text NULL,
  ADD COLUMN IF NOT EXISTS business_stream text NULL;

-- CHECK constraints (no SQL ENUM)
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_provider_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_provider_check
  CHECK (provider IN ('bepaid','stripe','admin','admin_test','admin_test_direct'));

ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_provider_mode_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_provider_mode_check
  CHECK (provider_mode IN ('fixed','customer_choice'));

-- Helpful index for future filtering by provider in admin UI
CREATE INDEX IF NOT EXISTS idx_payment_links_provider
  ON public.payment_links(provider);

COMMENT ON COLUMN public.payment_links.provider IS 'Acquiring provider: bepaid (default) | stripe | admin* (manual). Phase 1 Stripe integration.';
COMMENT ON COLUMN public.payment_links.provider_mode IS 'fixed = provider locked at link creation; customer_choice = user picks at checkout (future). No auto mode.';
COMMENT ON COLUMN public.payment_links.account_code IS 'Future-ready: acquiring account code (e.g. stripe_poland). NULL on MVP single-account.';
COMMENT ON COLUMN public.payment_links.profile_code IS 'Future-ready: payment profile preset code (e.g. stripe_standard_eur). NULL on MVP.';
COMMENT ON COLUMN public.payment_links.business_stream IS 'Future-ready: business classification (accounting_school|consulting|documents|club|marketplace). NULL until Phase 2.';