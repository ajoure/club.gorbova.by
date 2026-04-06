
CREATE OR REPLACE FUNCTION public.get_deal_tab_counts(
  p_search text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (
    SELECT
      o.id,
      o.status,
      o.is_trial,
      o.reconcile_source
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE
      (p_product_id IS NULL OR o.product_id = p_product_id)
      AND (p_date_from IS NULL OR o.deal_date >= p_date_from)
      AND (p_date_to IS NULL OR o.deal_date <= p_date_to)
      AND (
        p_search IS NULL
        OR o.order_number ILIKE '%' || p_search || '%'
        OR o.customer_email ILIKE '%' || p_search || '%'
        OR o.customer_phone ILIKE '%' || p_search || '%'
        OR p.full_name ILIKE '%' || p_search || '%'
        OR p.email ILIKE '%' || p_search || '%'
      )
  )
  SELECT jsonb_build_object(
    'all', (SELECT count(*) FROM base),
    'paid', (SELECT count(*) FROM base WHERE status = 'paid'),
    'pending', (SELECT count(*) FROM base WHERE status = 'pending'),
    'failed', (SELECT count(*) FROM base WHERE status = 'failed'),
    'trial', (SELECT count(*) FROM base WHERE is_trial = true),
    'canceled', (SELECT count(*) FROM base WHERE status IN ('canceled', 'cancelled', 'refunded')),
    'imported', (SELECT count(*) FROM base WHERE reconcile_source IN ('bepaid_archive_import', 'getcourse_historical', 'csv_active_import'))
  ) INTO result;

  RETURN result;
END;
$$;
