ALTER VIEW public.payment_links_enriched_v
  SET (security_invoker = true);

REVOKE ALL ON public.payment_links_enriched_v
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.payment_links_enriched_v TO service_role;