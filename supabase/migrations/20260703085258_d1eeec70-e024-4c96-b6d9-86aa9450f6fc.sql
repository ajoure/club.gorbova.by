
CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_provider text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_provider text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (
       public.has_role_v2(auth.uid(), 'super_admin')
       OR public.has_role_v2(auth.uid(), 'admin')
     ) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
  END IF;

  v_provider := lower(COALESCE(NULLIF(p_provider, ''), 'all'));
  IF v_provider NOT IN ('all', 'bepaid', 'stripe') THEN
    RAISE EXCEPTION 'invalid_provider: %', p_provider
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    'successful_count', COUNT(*) FILTER (
      WHERE status::text IN ('successful','succeeded')
        AND COALESCE(transaction_type,'') NOT IN ('refund','void','Возврат средств','Отмена')
        AND amount > 0
    ),
    'successful_amount', COALESCE(SUM(amount) FILTER (
      WHERE status::text IN ('successful','succeeded')
        AND COALESCE(transaction_type,'') NOT IN ('refund','void','Возврат средств','Отмена')
        AND amount > 0
    ), 0),
    'refunded_count', COUNT(*) FILTER (
      WHERE COALESCE(transaction_type,'') IN ('refund','Возврат средств')
        OR status::text = 'refunded'
    ),
    'refunded_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE COALESCE(transaction_type,'') IN ('refund','Возврат средств')
        OR status::text = 'refunded'
    ), 0),
    'cancelled_count', COUNT(*) FILTER (
      WHERE COALESCE(transaction_type,'') IN ('void','Отмена')
        OR status::text IN ('cancelled','canceled','void')
    ),
    'cancelled_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE COALESCE(transaction_type,'') IN ('void','Отмена')
        OR status::text IN ('cancelled','canceled','void')
    ), 0),
    'failed_count', COUNT(*) FILTER (
      WHERE status::text IN ('failed','declined','expired','error')
        AND COALESCE(transaction_type,'') NOT IN ('void','Отмена')
    ),
    'failed_amount', COALESCE(SUM(ABS(amount)) FILTER (
      WHERE status::text IN ('failed','declined','expired','error')
        AND COALESCE(transaction_type,'') NOT IN ('void','Отмена')
    ), 0),
    'processing_count', COUNT(*) FILTER (
      WHERE status::text IN ('pending','processing')
    ),
    'processing_amount', COALESCE(SUM(amount) FILTER (
      WHERE status::text IN ('pending','processing')
    ), 0),
    'commission_total', COALESCE(SUM(
      NULLIF(
        regexp_replace(
          replace(COALESCE(meta->>'commission_total', '0'), ',', '.'),
          '[^0-9.\-]', '', 'g'
        ), ''
      )::numeric
    ) FILTER (
      WHERE meta ? 'commission_total'
        AND status::text IN ('successful','succeeded')
        AND COALESCE(transaction_type,'') NOT IN ('refund','void','Возврат средств','Отмена')
    ), 0),
    'payout_total', COALESCE(SUM(
      NULLIF(
        regexp_replace(
          replace(COALESCE(meta->>'payout_amount', '0'), ',', '.'),
          '[^0-9.\-]', '', 'g'
        ), ''
      )::numeric
    ) FILTER (
      WHERE meta ? 'payout_amount'
        AND status::text IN ('successful','succeeded')
        AND COALESCE(transaction_type,'') NOT IN ('refund','void','Возврат средств','Отмена')
    ), 0)
  )
  INTO result
  FROM public.payments_v2
  WHERE (v_provider = 'all' OR provider = v_provider)
    AND paid_at >= p_from AND paid_at <= p_to;

  RETURN result;
END;
$function$;
