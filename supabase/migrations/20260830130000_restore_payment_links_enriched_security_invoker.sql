-- Restore invoker-rights semantics after CREATE OR REPLACE VIEW in the
-- Products 2 manager-attribution migration and remove the platform-default
-- direct client grants. Admin reads go through get_admin_payment_links_v1;
-- service_role keeps read-only access for trusted server-side diagnostics.
ALTER VIEW public.payment_links_enriched_v
  SET (security_invoker = true);

REVOKE ALL ON public.payment_links_enriched_v
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payment_links_enriched_v TO service_role;
