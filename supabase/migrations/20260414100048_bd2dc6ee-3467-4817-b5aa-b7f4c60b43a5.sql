-- Add unique partial index to enforce 1 product ↔ 1 canonical page
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_pages_product_id_unique
ON public.site_pages (product_id)
WHERE product_id IS NOT NULL;