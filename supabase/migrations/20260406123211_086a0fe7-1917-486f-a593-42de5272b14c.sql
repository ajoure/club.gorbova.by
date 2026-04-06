-- PATCH-DEALS-SEARCH-RESOLVER-FIX
-- Add product name, product code, and tariff name to search in both RPCs

CREATE OR REPLACE FUNCTION public.get_deal_tab_counts(
  p_search text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
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
    LEFT JOIN products_v2 pr ON pr.id = o.product_id
    LEFT JOIN tariffs t ON t.id = o.tariff_id
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
        OR pr.name ILIKE '%' || p_search || '%'
        OR pr.code ILIKE '%' || p_search || '%'
        OR t.name ILIKE '%' || p_search || '%'
      )
  )
  SELECT jsonb_build_object(
    'all', (SELECT count(*) FROM base),
    'paid', (SELECT count(*) FROM base WHERE status = 'paid'),
    'pending', (SELECT count(*) FROM base WHERE status = 'pending'),
    'failed', (SELECT count(*) FROM base WHERE status = 'failed'),
    'trial', (SELECT count(*) FROM base WHERE is_trial = true),
    'canceled', (SELECT count(*) FROM base WHERE status IN ('canceled', 'refunded')),
    'imported', (SELECT count(*) FROM base WHERE reconcile_source IN ('bepaid_archive_import', 'getcourse_historical', 'csv_active_import'))
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_deal_rows(
  p_search text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_preset text DEFAULT 'all',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  order_number text,
  status text,
  deal_date timestamptz,
  created_at timestamptz,
  customer_email text,
  customer_phone text,
  final_price numeric,
  currency text,
  discount_percent numeric,
  is_trial boolean,
  trial_end_at timestamptz,
  product_id uuid,
  tariff_id uuid,
  user_id uuid,
  profile_id uuid,
  reconcile_source text,
  purchase_snapshot jsonb,
  meta jsonb,
  product_name text,
  product_code text,
  tariff_name text,
  profile_full_name text,
  profile_email text,
  profile_phone text,
  profile_avatar_url text,
  profile_user_id uuid,
  latest_payment_id uuid,
  latest_payment_status text,
  latest_payment_paid_at timestamptz,
  latest_payment_card_holder text,
  latest_payment_meta jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.status::text,
    o.deal_date,
    o.created_at,
    o.customer_email,
    o.customer_phone,
    o.final_price,
    o.currency,
    o.discount_percent,
    o.is_trial,
    o.trial_end_at,
    o.product_id,
    o.tariff_id,
    o.user_id,
    o.profile_id,
    o.reconcile_source,
    o.purchase_snapshot,
    o.meta,
    pr.name AS product_name,
    pr.code AS product_code,
    t.name AS tariff_name,
    p.full_name AS profile_full_name,
    p.email AS profile_email,
    p.phone AS profile_phone,
    p.avatar_url AS profile_avatar_url,
    p.user_id AS profile_user_id,
    pay.id AS latest_payment_id,
    pay.status::text AS latest_payment_status,
    pay.paid_at AS latest_payment_paid_at,
    pay.card_holder AS latest_payment_card_holder,
    pay.meta AS latest_payment_meta
  FROM orders_v2 o
  LEFT JOIN profiles p ON p.id = o.profile_id
  LEFT JOIN products_v2 pr ON pr.id = o.product_id
  LEFT JOIN tariffs t ON t.id = o.tariff_id
  LEFT JOIN LATERAL (
    SELECT pay2.id, pay2.status, pay2.paid_at, pay2.card_holder, pay2.meta
    FROM payments_v2 pay2
    WHERE pay2.order_id = o.id
    ORDER BY COALESCE(pay2.paid_at, pay2.created_at) DESC
    LIMIT 1
  ) pay ON true
  WHERE
    (p_preset = 'all' OR p_preset IS NULL
      OR (p_preset = 'trial' AND o.is_trial = true)
      OR (p_preset = 'canceled' AND o.status IN ('canceled', 'refunded'))
      OR (p_preset = 'imported' AND o.reconcile_source IN ('bepaid_archive_import', 'getcourse_historical', 'csv_active_import'))
    )
    AND (p_product_id IS NULL OR o.product_id = p_product_id)
    AND (p_date_from IS NULL OR o.deal_date >= p_date_from)
    AND (p_date_to IS NULL OR o.deal_date <= p_date_to)
    AND (
      p_search IS NULL
      OR o.order_number ILIKE '%' || p_search || '%'
      OR o.customer_email ILIKE '%' || p_search || '%'
      OR o.customer_phone ILIKE '%' || p_search || '%'
      OR p.full_name ILIKE '%' || p_search || '%'
      OR p.email ILIKE '%' || p_search || '%'
      OR pr.name ILIKE '%' || p_search || '%'
      OR pr.code ILIKE '%' || p_search || '%'
      OR t.name ILIKE '%' || p_search || '%'
    )
  ORDER BY o.deal_date DESC NULLS LAST, o.id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;