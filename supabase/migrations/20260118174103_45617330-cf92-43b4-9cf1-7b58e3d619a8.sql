-- Обновляем функцию get_payments_stats для поддержки payment_status_overrides
-- Приводим payment_status enum к text для совместимости с COALESCE
CREATE OR REPLACE FUNCTION public.get_payments_stats(from_date timestamp with time zone, to_date timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  WITH unified_payments AS (
    -- payments_v2 (обработанные платежи)
    SELECT 
      p.provider_payment_id as uid,
      p.provider,
      p.amount,
      p.transaction_type,
      COALESCE(o.status_override, p.status::text) as effective_status,
      p.paid_at
    FROM payments_v2 p
    LEFT JOIN payment_status_overrides o 
      ON o.uid = p.provider_payment_id AND o.provider = p.provider
    WHERE p.provider = 'bepaid'
      AND p.paid_at >= from_date 
      AND p.paid_at < (to_date + interval '1 day')
      AND p.provider_payment_id IS NOT NULL
      
    UNION ALL
    
    -- payment_reconcile_queue (только те, которых НЕТ в payments_v2)
    SELECT 
      q.bepaid_uid as uid,
      COALESCE(q.provider, 'bepaid') as provider,
      q.amount,
      q.transaction_type,
      COALESCE(o.status_override, q.status_normalized) as effective_status,
      q.paid_at
    FROM payment_reconcile_queue q
    LEFT JOIN payment_status_overrides o 
      ON o.uid = q.bepaid_uid AND o.provider = COALESCE(q.provider, 'bepaid')
    WHERE q.bepaid_uid IS NOT NULL
      AND (q.is_fee IS NULL OR q.is_fee = false)
      AND q.paid_at >= from_date 
      AND q.paid_at < (to_date + interval '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM payments_v2 p2 
        WHERE p2.provider_payment_id = q.bepaid_uid 
          AND p2.provider = COALESCE(q.provider, 'bepaid')
      )
  )
  SELECT json_build_object(
    -- Успешные: платежи с effective_status = successful/succeeded
    'successful_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay') 
           AND effective_status IN ('successful', 'succeeded')
           AND amount > 0
      THEN amount ELSE 0 END
    ), 0),
    'successful_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip', 'payment_apple_pay', 'payment_google_pay') 
        AND effective_status IN ('successful', 'succeeded')
        AND amount > 0
    ),
    
    -- Ожидающие
    'pending_amount', COALESCE(SUM(
      CASE WHEN effective_status IN ('pending', 'processing')
           AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
      THEN amount ELSE 0 END
    ), 0),
    'pending_count', COUNT(*) FILTER (
      WHERE effective_status IN ('pending', 'processing')
        AND transaction_type IN ('Платеж', 'payment', 'payment_card', 'payment_erip')
    ),
    
    -- Возвраты
    'refunded_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Возврат средств', 'refund', 'refunded') 
           OR effective_status = 'refunded'
      THEN ABS(amount) ELSE 0 END
    ), 0),
    'refunded_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Возврат средств', 'refund', 'refunded')
        OR effective_status = 'refunded'
    ),
    
    -- Отмены
    'cancelled_amount', COALESCE(SUM(
      CASE WHEN transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void') 
           OR effective_status IN ('cancelled', 'canceled', 'void')
      THEN amount ELSE 0 END
    ), 0),
    'cancelled_count', COUNT(*) FILTER (
      WHERE transaction_type IN ('Отмена', 'void', 'cancellation', 'authorization_void')
        OR effective_status IN ('cancelled', 'canceled', 'void')
    ),
    
    -- Неуспешные (исключая отмены)
    'failed_amount', COALESCE(SUM(
      CASE WHEN effective_status IN ('failed', 'error', 'declined', 'expired', 'incomplete') 
           AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
      THEN amount ELSE 0 END
    ), 0),
    'failed_count', COUNT(*) FILTER (
      WHERE effective_status IN ('failed', 'error', 'declined', 'expired', 'incomplete')
        AND transaction_type NOT IN ('Отмена', 'void', 'cancellation', 'authorization_void')
    ),
    
    'total_count', COUNT(*)
  )
  FROM unified_payments
$function$;