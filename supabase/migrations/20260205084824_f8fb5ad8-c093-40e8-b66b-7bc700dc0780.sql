-- Fix admin_get_payments_stats_v1 to correctly cast enum to text
CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(
  p_from TIMESTAMPTZ, 
  p_to TIMESTAMPTZ, 
  p_provider TEXT DEFAULT 'bepaid'
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    -- Successful: status IN (successful, succeeded), not refund/void, amount > 0
    'successful_count', COUNT(*) FILTER (
      WHERE status::text IN ('successful','succeeded') 
        AND COALESCE(transaction_type,'') NOT IN ('refund','void') 
        AND amount > 0
    ),
    'successful_amount', COALESCE(SUM(amount) FILTER (
      WHERE status::text IN ('successful','succeeded') 
        AND COALESCE(transaction_type,'') NOT IN ('refund','void') 
        AND amount > 0
    ), 0),
    -- Refunds: transaction_type=refund OR status=refunded OR amount < 0
    'refunded_count', COUNT(*) FILTER (
      WHERE transaction_type = 'refund' 
        OR status::text = 'refunded'
        OR (status::text IN ('successful','succeeded') AND amount < 0)
    ),
    'refunded_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE transaction_type = 'refund' 
        OR status::text = 'refunded'
        OR (status::text IN ('successful','succeeded') AND amount < 0)
    ), 0),
    -- Cancelled: transaction_type=void OR status IN (cancelled, canceled, void)
    'cancelled_count', COUNT(*) FILTER (
      WHERE transaction_type = 'void' 
        OR status::text IN ('cancelled','canceled','void')
    ),
    'cancelled_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE transaction_type = 'void' 
        OR status::text IN ('cancelled','canceled','void')
    ), 0),
    -- Failed: status IN (failed, declined, expired, error), not void, not processing
    'failed_count', COUNT(*) FILTER (
      WHERE status::text IN ('failed','declined','expired','error') 
        AND COALESCE(transaction_type,'') <> 'void'
    ),
    'failed_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE status::text IN ('failed','declined','expired','error') 
        AND COALESCE(transaction_type,'') <> 'void'
    ), 0),
    -- Processing: status IN (pending, processing, incomplete, pending_3ds)
    'processing_count', COUNT(*) FILTER (
      WHERE status::text IN ('pending','processing','incomplete','pending_3ds')
    ),
    'processing_amount', COALESCE(SUM(amount) FILTER (
      WHERE status::text IN ('pending','processing','incomplete','pending_3ds')
    ), 0),
    -- Commission from meta (synced from bePaid statement)
    'commission_total', COALESCE(SUM((meta->>'commission_total')::numeric) FILTER (
      WHERE meta ? 'commission_total' 
        AND status::text IN ('successful','succeeded')
        AND COALESCE(transaction_type,'') NOT IN ('refund','void')
    ), 0)
  )
  INTO result
  FROM public.payments_v2
  WHERE provider = p_provider
    AND paid_at >= p_from 
    AND paid_at <= p_to;

  RETURN result;
END;
$$;