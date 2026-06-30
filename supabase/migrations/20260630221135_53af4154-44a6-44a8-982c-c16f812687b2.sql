-- Fix: public published pages must be readable by authenticated users too,
-- otherwise logged-in users get 404 on landing pages (only anon had SELECT).
DROP POLICY IF EXISTS site_pages_public_select ON public.site_pages;
CREATE POLICY site_pages_public_select
  ON public.site_pages
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS site_domain_bindings_public_select ON public.site_domain_bindings;
CREATE POLICY site_domain_bindings_public_select
  ON public.site_domain_bindings
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.site_pages TO authenticated;
GRANT SELECT ON public.site_domain_bindings TO authenticated;