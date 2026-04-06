-- PATCH-ID-FIRST-HIGH-RISK-EXECUTE: Replace hardcoded code sets with DB-driven column
ALTER TABLE public.products_v2 
ADD COLUMN IF NOT EXISTS entitlement_mode text DEFAULT NULL;

COMMENT ON COLUMN public.products_v2.entitlement_mode IS 
'Controls entitlement sync behavior: subscription_based, order_based_only, legacy_skip. NULL = not configured.';

-- Backfill from current hardcoded SUBSCRIPTION_BASED_CODES
UPDATE public.products_v2 SET entitlement_mode = 'subscription_based'
WHERE code IN ('club', 'buh_business', 'cb_module_ip', 'prd_0d01a2fdc477', 'course_close_year', '1769009596189-398a')
  AND entitlement_mode IS NULL;

-- Backfill from current hardcoded ORDER_BASED_ONLY_CODES
UPDATE public.products_v2 SET entitlement_mode = 'order_based_only'
WHERE code = 'cb20'
  AND entitlement_mode IS NULL;

-- Backfill from current hardcoded LEGACY_SKIP_CODES
UPDATE public.products_v2 SET entitlement_mode = 'legacy_skip'
WHERE code = 'cb_2_step'
  AND entitlement_mode IS NULL;