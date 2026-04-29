-- PATCH-DEALS-MULTITERM-SEARCH
-- Поиск по сделкам: multi-term AND по объединённой строке полей
-- (поведение как в контактах через matchSearchIndex/buildSearchIndex).

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
  v_terms text[];
BEGIN
  IF p_search IS NOT NULL AND length(btrim(p_search)) > 0 THEN
    SELECT array_agg(t)
      INTO v_terms
      FROM (
        SELECT lower(btrim(unnest(regexp_split_to_array(p_search, '\s+')))) AS t
      ) s
      WHERE t <> '';
  END IF;

  WITH base AS (
    SELECT
      o.id,
      o.status,
      o.is_trial,
      o.reconcile_source,
      lower(
        coalesce(o.order_number, '') || ' ' ||
        coalesce(o.customer_email, '') || ' ' ||
        coalesce(o.customer_phone, '') || ' ' ||
        coalesce(p.full_name, '') || ' ' ||
        coalesce(p.email, '') || ' ' ||
        coalesce(p.phone, '') || ' ' ||
        coalesce(pr.name, '') || ' ' ||
        coalesce(pr.code, '') || ' ' ||
        coalesce(t.name, '')
      ) AS search_blob
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    LEFT JOIN products_v2 pr ON pr.id = o.product_id
    LEFT JOIN tariffs t ON t.id = o.tariff_id
    WHERE
      (p_product_id IS NULL OR o.product_id = p_product_id)
      AND (p_date_from IS NULL OR o.deal_date >= p_date_from)
      AND (p_date_to IS NULL OR o.deal_date <= p_date_to)
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE
      v_terms IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(v_terms) AS term
        WHERE position(term IN base.search_blob) = 0
      )
  )
  SELECT jsonb_build_object(
    'all', (SELECT count(*) FROM filtered),
    'paid', (SELECT count(*) FROM filtered WHERE status = 'paid'),
    'pending', (SELECT count(*) FROM filtered WHERE status = 'pending'),
    'failed', (SELECT count(*) FROM filtered WHERE status = 'failed'),
    'trial', (SELECT count(*) FROM filtered WHERE is_trial = true),
    'canceled', (SELECT count(*) FROM filtered WHERE status IN ('canceled', 'refunded')),
    'imported', (SELECT count(*) FROM filtered WHERE reconcile_source IN ('bepaid_archive_import', 'getcourse_historical', 'csv_active_import'))
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
DECLARE
  v_terms text[];
BEGIN
  IF p_search IS NOT NULL AND length(btrim(p_search)) > 0 THEN
    SELECT array_agg(t)
      INTO v_terms
      FROM (
        SELECT lower(btrim(unnest(regexp_split_to_array(p_search, '\s+')))) AS t
      ) s
      WHERE t <> '';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      o.id            AS o_id,
      o.order_number  AS o_order_number,
      o.status        AS o_status,
      o.deal_date     AS o_deal_date,
      o.created_at    AS o_created_at,
      o.customer_email AS o_customer_email,
      o.customer_phone AS o_customer_phone,
      o.final_price   AS o_final_price,
      o.currency      AS o_currency,
      o.discount_percent AS o_discount_percent,
      o.is_trial      AS o_is_trial,
      o.trial_end_at  AS o_trial_end_at,
      o.product_id    AS o_product_id,
      o.tariff_id     AS o_tariff_id,
      o.user_id       AS o_user_id,
      o.profile_id    AS o_profile_id,
      o.reconcile_source AS o_reconcile_source,
      o.purchase_snapshot AS o_purchase_snapshot,
      o.meta          AS o_meta,
      pr.name         AS pr_name,
      pr.code         AS pr_code,
      t.name          AS t_name,
      p.full_name     AS p_full_name,
      p.email         AS p_email,
      p.phone         AS p_phone,
      p.avatar_url    AS p_avatar_url,
      p.user_id       AS p_user_id,
      lower(
        coalesce(o.order_number, '') || ' ' ||
        coalesce(o.customer_email, '') || ' ' ||
        coalesce(o.customer_phone, '') || ' ' ||
        coalesce(p.full_name, '') || ' ' ||
        coalesce(p.email, '') || ' ' ||
        coalesce(p.phone, '') || ' ' ||
        coalesce(pr.name, '') || ' ' ||
        coalesce(pr.code, '') || ' ' ||
        coalesce(t.name, '')
      ) AS search_blob
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    LEFT JOIN products_v2 pr ON pr.id = o.product_id
    LEFT JOIN tariffs t ON t.id = o.tariff_id
    WHERE
      (p_preset = 'all' OR p_preset IS NULL
        OR (p_preset = 'trial' AND o.is_trial = true)
        OR (p_preset = 'canceled' AND o.status IN ('canceled', 'refunded'))
        OR (p_preset = 'imported' AND o.reconcile_source IN ('bepaid_archive_import', 'getcourse_historical', 'csv_active_import'))
      )
      AND (p_product_id IS NULL OR o.product_id = p_product_id)
      AND (p_date_from IS NULL OR o.deal_date >= p_date_from)
      AND (p_date_to IS NULL OR o.deal_date <= p_date_to)
  )
  SELECT
    b.o_id,
    b.o_order_number,
    b.o_status::text,
    b.o_deal_date,
    b.o_created_at,
    b.o_customer_email,
    b.o_customer_phone,
    b.o_final_price,
    b.o_currency,
    b.o_discount_percent,
    b.o_is_trial,
    b.o_trial_end_at,
    b.o_product_id,
    b.o_tariff_id,
    b.o_user_id,
    b.o_profile_id,
    b.o_reconcile_source,
    b.o_purchase_snapshot,
    b.o_meta,
    b.pr_name      AS product_name,
    b.pr_code      AS product_code,
    b.t_name       AS tariff_name,
    b.p_full_name  AS profile_full_name,
    b.p_email      AS profile_email,
    b.p_phone      AS profile_phone,
    b.p_avatar_url AS profile_avatar_url,
    b.p_user_id    AS profile_user_id,
    pay.id         AS latest_payment_id,
    pay.status::text AS latest_payment_status,
    pay.paid_at    AS latest_payment_paid_at,
    pay.card_holder AS latest_payment_card_holder,
    pay.meta       AS latest_payment_meta
  FROM base b
  LEFT JOIN LATERAL (
    SELECT pay2.id, pay2.status, pay2.paid_at, pay2.card_holder, pay2.meta
    FROM payments_v2 pay2
    WHERE pay2.order_id = b.o_id
    ORDER BY COALESCE(pay2.paid_at, pay2.created_at) DESC
    LIMIT 1
  ) pay ON true
  WHERE
    v_terms IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM unnest(v_terms) AS term
      WHERE position(term IN b.search_blob) = 0
    )
  ORDER BY b.o_deal_date DESC NULLS LAST, b.o_id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;