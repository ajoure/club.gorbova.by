
-- Sprint 6 Phase 1.5: Unique index (dedup check passed - 0 duplicates)
CREATE UNIQUE INDEX idx_entitlements_user_product_id
  ON public.entitlements(user_id, product_id)
  WHERE product_id IS NOT NULL;
