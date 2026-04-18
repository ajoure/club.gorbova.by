CREATE OR REPLACE VIEW public.payment_links_enriched_v AS
SELECT
  pl.id,
  pl.url_token,
  pl.product_id,
  pl.tariff_id,
  pl.offer_id,
  pl.amount,
  pl.currency,
  pl.payment_type,
  pl.description,
  pl.user_id,
  pl.status,
  pl.max_uses,
  pl.current_uses,
  pl.expires_at,
  pl.created_by,
  pl.created_at,
  pl.updated_at,
  p.name AS product_name,
  t.name AS tariff_name,
  tof.button_label AS offer_title,
  rec.full_name AS recipient_name,
  rec.email AS recipient_email,
  cre.full_name AS creator_name,
  cre.email AS creator_email,
  (pl.expires_at IS NOT NULL AND pl.expires_at < now()) AS is_expired,
  (pl.max_uses IS NOT NULL AND pl.current_uses >= pl.max_uses) AS is_exhausted,
  (
    pl.status <> 'active'
    OR (pl.expires_at IS NOT NULL AND pl.expires_at < now())
    OR (pl.max_uses IS NOT NULL AND pl.current_uses >= pl.max_uses)
  ) AS is_invalid,
  (SELECT count(*)::int FROM public.orders_v2 o WHERE o.meta->>'payment_link_id' = pl.id::text) AS related_orders_count,
  (SELECT count(*)::int FROM public.orders_v2 o WHERE o.meta->>'payment_link_id' = pl.id::text AND o.status = 'paid') AS paid_orders_count,
  (
    SELECT o.id FROM public.orders_v2 o
    WHERE o.meta->>'payment_link_id' = pl.id::text
    ORDER BY o.created_at DESC LIMIT 1
  ) AS last_order_id
FROM public.payment_links pl
LEFT JOIN public.products_v2 p ON p.id = pl.product_id
LEFT JOIN public.tariffs t ON t.id = pl.tariff_id
LEFT JOIN public.tariff_offers tof ON tof.id = pl.offer_id
LEFT JOIN public.profiles rec ON rec.id = pl.user_id
LEFT JOIN public.profiles cre ON cre.id = pl.created_by;

REVOKE ALL ON public.payment_links_enriched_v FROM anon, authenticated;
GRANT SELECT ON public.payment_links_enriched_v TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_payment_links_enriched()
RETURNS SETOF public.payment_links_enriched_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.payment_links_enriched_v ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payment_links_enriched() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_links_enriched() TO authenticated;