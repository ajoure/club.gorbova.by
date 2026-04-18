CREATE OR REPLACE FUNCTION public.admin_list_payment_links_enriched()
RETURNS SETOF public.payment_links_enriched_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.payment_links_enriched_v ORDER BY created_at DESC LIMIT 1000;
END;
$$;