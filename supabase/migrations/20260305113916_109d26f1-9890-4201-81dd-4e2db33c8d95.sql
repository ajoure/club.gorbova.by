
-- Sprint 6 Phase 1: Add product_id to entitlements + backfill + index

-- 1) Add column
ALTER TABLE public.entitlements 
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products_v2(id) ON DELETE SET NULL;

-- 2) Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_entitlements_product_id ON public.entitlements(product_id);

-- 3) Backfill from products_v2.code
UPDATE entitlements e
SET product_id = p.id
FROM products_v2 p
WHERE p.code = e.product_code 
  AND e.product_id IS NULL;
