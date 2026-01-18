-- Шаг 1: Исправить флаг is_fee для отмен (они НЕ комиссии!)
UPDATE payment_reconcile_queue
SET is_fee = false
WHERE transaction_type = 'Отмена'
  AND is_fee = true;

-- Шаг 2: Обновить RPC функцию get_payments_stats с правильной логикой
CREATE OR REPLACE FUNCTION public.get_payments_stats(
    from_date timestamptz, 
    to_date timestamptz
)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    -- Успешные: только платежи (не отмены, не возвраты) со статусом successful
    'successful_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip') 
           AND status_normalized = 'successful' 
      THEN amount ELSE 0 END
    ), 0),
    'successful_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip') 
        AND status_normalized = 'successful'
    ),
    
    -- Возвраты: по типу транзакции (любой статус)
    'refunded_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Возврат средств', 'refund', 'refunded') 
      THEN ABS(amount) ELSE 0 END
    ), 0),
    'refunded_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Возврат средств', 'refund', 'refunded')
    ),
    
    -- Отмены: по типу транзакции (НЕ по статусу!)
    'cancelled_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void') 
      THEN amount ELSE 0 END
    ), 0),
    'cancelled_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void')
    ),
    
    -- Неуспешные: по статусу, исключая отмены
    'failed_amount', COALESCE(SUM(
      CASE WHEN status_normalized IN ('failed', 'error', 'declined', 'expired', 'incomplete') 
           AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
      THEN amount ELSE 0 END
    ), 0),
    'failed_count', COUNT(*) FILTER (
      WHERE status_normalized IN ('failed', 'error', 'declined', 'expired', 'incomplete')
        AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
    ),
    
    'pending_amount', COALESCE(SUM(CASE WHEN status_normalized = 'pending' THEN amount ELSE 0 END), 0),
    'pending_count', COUNT(*) FILTER (WHERE status_normalized = 'pending'),
    'total_count', COUNT(*)
  )
  FROM payment_reconcile_queue
  WHERE bepaid_uid IS NOT NULL
    AND paid_at >= from_date 
    AND paid_at <= to_date
$$;