-- Restore invoker-rights semantics after CREATE OR REPLACE VIEW in the
-- Products 2 manager-attribution migration. The view must never execute with
-- its owner's privileges, even when grants change later.
ALTER VIEW public.payment_links_enriched_v
  SET (security_invoker = true);
