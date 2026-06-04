-- MP-A2-2: add generic meta jsonb column on profiles to store the per-account
-- Stripe Customer cache at profiles.meta.stripe.customers[<account_code>].
-- Add-only nullable column with safe default; no policy / RLS change required.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;