
-- Обновляем функцию статистики - используем ТОЛЬКО status_normalized
CREATE OR REPLACE FUNCTION public.get_payments_stats(
    from_date timestamp with time zone, 
    to_date timestamp with time zone
)
RETURNS json
LANGUAGE sql
STABLE
AS $function$
  SELECT json_build_object(
    -- Успешные: только реально завершённые платежи (по status_normalized)
    'successful_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay') 
           AND status_normalized = 'successful' 
      THEN amount ELSE 0 END
    ), 0),
    'successful_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay') 
        AND status_normalized = 'successful'
    ),
    
    -- Ожидающие (по status_normalized)
    'pending_amount', COALESCE(SUM(
      CASE WHEN status_normalized = 'pending'
           AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
      THEN amount ELSE 0 END
    ), 0),
    'pending_count', COUNT(*) FILTER (
      WHERE status_normalized = 'pending'
        AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
    ),
    
    -- Возвраты
    'refunded_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Возврат средств', 'refund', 'refunded') 
      THEN ABS(amount) ELSE 0 END
    ), 0),
    'refunded_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Возврат средств', 'refund', 'refunded')
    ),
    
    -- Отмены
    'cancelled_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void') 
      THEN amount ELSE 0 END
    ), 0),
    'cancelled_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void')
    ),
    
    -- Неуспешные (исключая отмены)
    'failed_amount', COALESCE(SUM(
      CASE WHEN status_normalized IN ('failed', 'error', 'declined', 'expired', 'incomplete') 
           AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
      THEN amount ELSE 0 END
    ), 0),
    'failed_count', COUNT(*) FILTER (
      WHERE status_normalized IN ('failed', 'error', 'declined', 'expired', 'incomplete')
        AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
    ),
    
    'total_count', COUNT(*)
  )
  FROM payment_reconcile_queue
  WHERE bepaid_uid IS NOT NULL
    AND paid_at >= from_date 
    AND paid_at < (to_date + interval '1 day')
$function$;
