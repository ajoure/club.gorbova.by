-- Add include_import parameter to get_payments_stats RPC
-- This allows dashboard to show either 'bepaid only' or 'bepaid + import' data

CREATE OR REPLACE FUNCTION public.get_payments_stats(
  from_date timestamp with time zone, 
  to_date timestamp with time zone,
  include_import boolean DEFAULT false
)
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  WITH base_payments AS (
    SELECT 
      p.provider_payment_id as uid,
      p.provider,
      p.amount,
      p.transaction_type,
      COALESCE(o.status_override, p.status::text) as effective_status,
      p.paid_at,
      p.currency
    FROM payments_v2 p
    LEFT JOIN payment_status_overrides o 
      ON o.uid = p.provider_payment_id AND o.provider = p.provider
    WHERE p.provider = 'bepaid'
      AND (
        (NOT include_import AND p.origin = 'bepaid') OR
        (include_import AND p.origin IN ('bepaid', 'import'))
      )
      AND p.paid_at >= from_date 
      AND p.paid_at < (to_date + interval '1 day')
      AND p.provider_payment_id IS NOT NULL
  ),
  classified AS (
    SELECT 
      *,
      -- Centralized classification
      (effective_status IN ('successful', 'succeeded')) AS is_success,
      (effective_status IN ('failed', 'error', 'declined', 'expired', 'incomplete')) AS is_failed,
      (transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void') 
        OR effective_status IN ('cancelled', 'canceled', 'void')) AS is_cancel,
      (transaction_type IN ('Возврат средств', 'refund', 'refunded') 
        OR effective_status = 'refunded') AS is_refund
    FROM base_payments
  ),
  aggregated AS (
    SELECT
      -- Successful: payment transactions with status = successful/succeeded
      COUNT(*) FILTER (
        WHERE is_success 
          AND NOT is_refund 
          AND NOT is_cancel
          AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay')
          AND amount > 0
      ) AS successful_count,
      COALESCE(SUM(amount) FILTER (
        WHERE is_success 
          AND NOT is_refund 
          AND NOT is_cancel
          AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay')
          AND amount > 0
      ), 0) AS successful_amount,
      
      -- Pending
      COUNT(*) FILTER (
        WHERE effective_status IN ('pending', 'processing')
          AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
      ) AS pending_count,
      COALESCE(SUM(amount) FILTER (
        WHERE effective_status IN ('pending', 'processing')
          AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
      ), 0) AS pending_amount,
      
      -- Refunds (absolute value)
      COUNT(*) FILTER (WHERE is_refund) AS refunded_count,
      COALESCE(SUM(ABS(amount)) FILTER (WHERE is_refund), 0) AS refunded_amount,
      
      -- Cancellations (absolute value)
      COUNT(*) FILTER (WHERE is_cancel AND NOT is_refund) AS cancelled_count,
      COALESCE(SUM(ABS(amount)) FILTER (WHERE is_cancel AND NOT is_refund), 0) AS cancelled_amount,
      
      -- Failed (excluding cancellations and refunds)
      COUNT(*) FILTER (WHERE is_failed AND NOT is_cancel AND NOT is_refund) AS failed_count,
      COALESCE(SUM(ABS(amount)) FILTER (WHERE is_failed AND NOT is_cancel AND NOT is_refund), 0) AS failed_amount,
      
      COUNT(*) AS total_count
    FROM classified
  )
  SELECT json_build_object(
    'successful_amount', successful_amount,
    'successful_count', successful_count,
    'pending_amount', pending_amount,
    'pending_count', pending_count,
    'refunded_amount', refunded_amount,
    'refunded_count', refunded_count,
    'cancelled_amount', cancelled_amount,
    'cancelled_count', cancelled_count,
    'failed_amount', failed_amount,
    'failed_count', failed_count,
    'total_count', total_count,
    'net_revenue', (successful_amount - refunded_amount - cancelled_amount)
  )
  FROM aggregated
$function$;