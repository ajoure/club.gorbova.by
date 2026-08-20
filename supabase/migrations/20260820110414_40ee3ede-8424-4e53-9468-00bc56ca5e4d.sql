-- A tariff may remain active for CRM/manual sales while being hidden from
-- every public product page. Existing tariffs stay public by default to keep
-- the migration backwards compatible; administrators can opt internal
-- tariffs out explicitly.
ALTER TABLE public.tariffs
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tariffs.is_public IS
  'Whether the active tariff is returned by public product endpoints and displayed on public sites.';

CREATE INDEX IF NOT EXISTS tariffs_public_product_sort_idx
  ON public.tariffs (product_id, sort_order, id)
  WHERE is_active = true AND is_public = true;