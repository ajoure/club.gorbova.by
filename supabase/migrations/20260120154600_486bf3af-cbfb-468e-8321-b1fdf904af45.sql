-- RPC: admin_unlinked_cards_report (aggregates with collision detection)
CREATE OR REPLACE FUNCTION public.admin_unlinked_cards_report(
  _limit INT DEFAULT 100,
  _offset INT DEFAULT 0,
  _brand TEXT DEFAULT NULL,
  _last4 TEXT DEFAULT NULL
)
RETURNS TABLE (
  last4 TEXT,
  brand TEXT,
  unlinked_payments_v2_count BIGINT,
  unlinked_queue_count BIGINT,
  payments_amount NUMERIC,
  queue_amount NUMERIC,
  total_amount NUMERIC,
  last_seen_at TIMESTAMPTZ,
  collision_risk BOOLEAN
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH payments_agg AS (
    SELECT 
      p.card_last4,
      lower(p.card_brand) as card_brand,
      COUNT(*)::BIGINT as cnt,
      COALESCE(SUM(p.amount), 0) as sum_amount,
      MAX(p.paid_at) as max_paid
    FROM payments_v2 p
    WHERE p.profile_id IS NULL
      AND p.card_last4 IS NOT NULL 
      AND p.card_brand IS NOT NULL
    GROUP BY p.card_last4, lower(p.card_brand)
  ),
  queue_agg AS (
    SELECT 
      q.card_last4,
      lower(q.card_brand) as card_brand,
      COUNT(*)::BIGINT as cnt,
      COALESCE(SUM(q.amount), 0) as sum_amount,
      MAX(COALESCE(q.paid_at, q.created_at)) as max_paid
    FROM payment_reconcile_queue q
    WHERE q.matched_profile_id IS NULL
      AND q.card_last4 IS NOT NULL 
      AND q.card_brand IS NOT NULL
    GROUP BY q.card_last4, lower(q.card_brand)
  ),
  combined AS (
    SELECT 
      COALESCE(p.card_last4, q.card_last4) as card_last4,
      COALESCE(p.card_brand, q.card_brand) as card_brand,
      COALESCE(p.cnt, 0) as payments_count,
      COALESCE(q.cnt, 0) as queue_count,
      COALESCE(p.sum_amount, 0) as payments_sum,
      COALESCE(q.sum_amount, 0) as queue_sum,
      GREATEST(p.max_paid, q.max_paid) as last_seen
    FROM payments_agg p
    FULL OUTER JOIN queue_agg q 
      ON p.card_last4 = q.card_last4 AND p.card_brand = q.card_brand
  ),
  collision_cards AS (
    SELECT cc.card_last4, cc.card_brand
    FROM (
      SELECT cpl.card_last4, lower(cpl.card_brand) as card_brand, cpl.profile_id 
      FROM card_profile_links cpl
      WHERE cpl.card_last4 IS NOT NULL AND cpl.card_brand IS NOT NULL
      UNION ALL
      SELECT pm.last4, lower(pm.brand), pr.id 
      FROM payment_methods pm 
      JOIN profiles pr ON pr.user_id = pm.user_id 
      WHERE pm.status = 'active' AND pm.last4 IS NOT NULL AND pm.brand IS NOT NULL
    ) cc
    GROUP BY cc.card_last4, cc.card_brand
    HAVING COUNT(DISTINCT cc.profile_id) >= 2
  )
  SELECT 
    c.card_last4 as last4,
    c.card_brand as brand,
    c.payments_count as unlinked_payments_v2_count,
    c.queue_count as unlinked_queue_count,
    c.payments_sum as payments_amount,
    c.queue_sum as queue_amount,
    (c.payments_sum + c.queue_sum) as total_amount,
    c.last_seen as last_seen_at,
    (EXISTS (SELECT 1 FROM collision_cards col WHERE col.card_last4 = c.card_last4 AND col.card_brand = c.card_brand)) as collision_risk
  FROM combined c
  WHERE 
    (_brand IS NULL OR c.card_brand = lower(_brand))
    AND (_last4 IS NULL OR c.card_last4 = _last4)
  ORDER BY (c.payments_count + c.queue_count) DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

-- RPC: admin_unlinked_cards_details (paginated details for a card)
CREATE OR REPLACE FUNCTION public.admin_unlinked_cards_details(
  _last4 TEXT,
  _brand TEXT,
  _limit INT DEFAULT 100,
  _offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  uid TEXT,
  amount NUMERIC,
  paid_at TIMESTAMPTZ,
  status TEXT,
  source TEXT,
  customer_email TEXT,
  card_holder TEXT,
  total_count BIGINT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  _total BIGINT;
BEGIN
  -- Count total for pagination
  SELECT 
    (SELECT COUNT(*) FROM payments_v2 
     WHERE profile_id IS NULL AND card_last4 = _last4 AND lower(card_brand) = lower(_brand))
    +
    (SELECT COUNT(*) FROM payment_reconcile_queue 
     WHERE matched_profile_id IS NULL AND card_last4 = _last4 AND lower(card_brand) = lower(_brand))
  INTO _total;

  RETURN QUERY
  SELECT * FROM (
    (
      SELECT 
        p.id,
        p.provider_payment_id as uid,
        p.amount,
        p.paid_at,
        p.status::TEXT,
        'payments_v2'::TEXT as source,
        p.customer_email,
        p.card_holder,
        _total as total_count
      FROM payments_v2 p
      WHERE p.profile_id IS NULL 
        AND p.card_last4 = _last4 
        AND lower(p.card_brand) = lower(_brand)
    )
    UNION ALL
    (
      SELECT 
        q.id,
        q.bepaid_uid as uid,
        q.amount,
        COALESCE(q.paid_at, q.created_at) as paid_at,
        q.status::TEXT,
        'queue'::TEXT as source,
        q.customer_email,
        q.card_holder,
        _total as total_count
      FROM payment_reconcile_queue q
      WHERE q.matched_profile_id IS NULL 
        AND q.card_last4 = _last4 
        AND lower(q.card_brand) = lower(_brand)
    )
  ) combined
  ORDER BY paid_at DESC NULLS LAST
  LIMIT _limit
  OFFSET _offset;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.admin_unlinked_cards_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlinked_cards_details TO authenticated;