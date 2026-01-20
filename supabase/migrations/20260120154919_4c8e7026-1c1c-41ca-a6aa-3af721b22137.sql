-- Fix admin_unlinked_cards_details: payments_v2 doesn't have customer_email/card_holder
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
        NULL::TEXT as customer_email,  -- payments_v2 doesn't have this column
        NULL::TEXT as card_holder,     -- payments_v2 doesn't have this column
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