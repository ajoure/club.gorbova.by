-- Phase 1 Stripe: expose new provider columns through enriched view + RPC

CREATE OR REPLACE VIEW public.payment_links_enriched_v AS
SELECT pl.id,
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
    (pl.status <> 'active'::text
      OR (pl.expires_at IS NOT NULL AND pl.expires_at < now())
      OR (pl.max_uses IS NOT NULL AND pl.current_uses >= pl.max_uses)) AS is_invalid,
    COALESCE(ord.related_orders_count, 0) AS related_orders_count,
    COALESCE(ord.paid_orders_count, 0) AS paid_orders_count,
    ord.last_order_id,
    pl.public_url,
    pl.provider,
    pl.provider_mode,
    pl.account_code,
    pl.profile_code,
    pl.business_stream
FROM payment_links pl
  LEFT JOIN products_v2 p ON p.id = pl.product_id
  LEFT JOIN tariffs t ON t.id = pl.tariff_id
  LEFT JOIN tariff_offers tof ON tof.id = pl.offer_id
  LEFT JOIN profiles rec ON rec.user_id = pl.user_id
  LEFT JOIN profiles cre ON cre.user_id = pl.created_by
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS related_orders_count,
           count(*) FILTER (WHERE o.status = 'paid'::order_status)::integer AS paid_orders_count,
           (array_agg(o.id ORDER BY o.created_at DESC))[1] AS last_order_id
    FROM orders_v2 o
    WHERE (o.meta ->> 'payment_link_id'::text) = pl.id::text
  ) ord ON true;

-- Recreate RPC so SETOF view picks up new columns
CREATE OR REPLACE FUNCTION public.get_admin_payment_links_v1(
  p_since timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 1000
)
RETURNS SETOF public.payment_links_enriched_v
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code IN ('admin','super_admin')
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.payment_links_enriched_v v
  WHERE p_since IS NULL OR v.updated_at > p_since
  ORDER BY v.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;