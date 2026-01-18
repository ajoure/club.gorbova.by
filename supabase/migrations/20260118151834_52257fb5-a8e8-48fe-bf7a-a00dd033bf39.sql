-- Update get_payments_stats to include 'refunded' status and add cancelled stats
DROP FUNCTION IF EXISTS get_payments_stats(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION get_payments_stats(from_date timestamptz, to_date timestamptz)
RETURNS JSON AS $$
  SELECT json_build_object(
    'successful_amount', COALESCE(SUM(CASE WHEN status_normalized = 'successful' THEN amount ELSE 0 END), 0),
    'successful_count', COUNT(*) FILTER (WHERE status_normalized = 'successful'),
    'refunded_amount', COALESCE(SUM(CASE WHEN status_normalized IN ('refund', 'refunded') THEN ABS(amount) ELSE 0 END), 0),
    'refunded_count', COUNT(*) FILTER (WHERE status_normalized IN ('refund', 'refunded')),
    'cancelled_amount', COALESCE(SUM(CASE WHEN status_normalized IN ('cancel', 'cancelled') THEN amount ELSE 0 END), 0),
    'cancelled_count', COUNT(*) FILTER (WHERE status_normalized IN ('cancel', 'cancelled')),
    'failed_amount', COALESCE(SUM(CASE WHEN status_normalized = 'failed' THEN amount ELSE 0 END), 0),
    'failed_count', COUNT(*) FILTER (WHERE status_normalized = 'failed'),
    'pending_amount', COALESCE(SUM(CASE WHEN status_normalized = 'pending' THEN amount ELSE 0 END), 0),
    'pending_count', COUNT(*) FILTER (WHERE status_normalized = 'pending'),
    'total_count', COUNT(*)
  )
  FROM payment_reconcile_queue
  WHERE is_fee = false 
    AND bepaid_uid IS NOT NULL
    AND paid_at >= from_date 
    AND paid_at <= to_date
$$ LANGUAGE sql STABLE;