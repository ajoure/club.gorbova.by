-- PATCH-5: Generated column sort_ts for stable keyset pagination
-- PATCH-7: RPC for server-side stats aggregation

-- Add computed sort_ts column = COALESCE(paid_at, created_at_bepaid)
ALTER TABLE public.bepaid_statement_rows
  ADD COLUMN IF NOT EXISTS sort_ts TIMESTAMPTZ 
  GENERATED ALWAYS AS (COALESCE(paid_at, created_at_bepaid)) STORED;

-- Index for keyset pagination: (sort_ts DESC, uid DESC)
CREATE INDEX IF NOT EXISTS idx_bepaid_statement_rows_sort_ts_uid 
  ON public.bepaid_statement_rows (sort_ts DESC NULLS LAST, uid DESC);

-- RPC function for server-side stats (no PII in result)
CREATE OR REPLACE FUNCTION public.get_bepaid_statement_stats(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'payments_count', COUNT(*) FILTER (
      WHERE (status ILIKE '%успешн%' OR status ILIKE '%successful%' OR status ILIKE '%succeeded%')
        AND NOT (transaction_type ILIKE '%возврат%' OR transaction_type ILIKE '%refund%')
        AND NOT (transaction_type ILIKE '%отмена%' OR transaction_type ILIKE '%void%' OR transaction_type ILIKE '%cancel%')
        AND amount > 0
    ),
    'payments_amount', COALESCE(SUM(amount) FILTER (
      WHERE (status ILIKE '%успешн%' OR status ILIKE '%successful%' OR status ILIKE '%succeeded%')
        AND NOT (transaction_type ILIKE '%возврат%' OR transaction_type ILIKE '%refund%')
        AND NOT (transaction_type ILIKE '%отмена%' OR transaction_type ILIKE '%void%' OR transaction_type ILIKE '%cancel%')
        AND amount > 0
    ), 0),
    'refunds_count', COUNT(*) FILTER (
      WHERE transaction_type ILIKE '%возврат%' OR transaction_type ILIKE '%refund%'
    ),
    'refunds_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE transaction_type ILIKE '%возврат%' OR transaction_type ILIKE '%refund%'
    ), 0),
    'cancellations_count', COUNT(*) FILTER (
      WHERE transaction_type ILIKE '%отмена%' OR transaction_type ILIKE '%void%' OR transaction_type ILIKE '%cancel%'
    ),
    'cancellations_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE transaction_type ILIKE '%отмена%' OR transaction_type ILIKE '%void%' OR transaction_type ILIKE '%cancel%'
    ), 0),
    'errors_count', COUNT(*) FILTER (
      WHERE status ILIKE '%ошибк%' OR status ILIKE '%failed%' OR status ILIKE '%declined%' OR status ILIKE '%error%'
    ),
    'errors_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE status ILIKE '%ошибк%' OR status ILIKE '%failed%' OR status ILIKE '%declined%' OR status ILIKE '%error%'
    ), 0),
    'commission_total', COALESCE(SUM(commission_total), 0),
    'payout_total', COALESCE(SUM(payout_amount), 0),
    'total_count', COUNT(*)
  )
  INTO result
  FROM bepaid_statement_rows
  WHERE sort_ts >= from_date 
    AND sort_ts <= to_date;
  
  RETURN result;
END;
$$;