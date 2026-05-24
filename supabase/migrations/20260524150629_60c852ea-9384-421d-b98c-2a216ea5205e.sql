
-- PATCH-PAYMENTS-STATS-RPC-GUARD-FIX-2026-05
-- Replace ONLY the guard in admin_get_payments_stats_v1.
-- Root cause: previous migration used 'super_admin'::app_role_v2 cast, but
--   has_role_v2(uuid, text) takes TEXT (no app_role_v2 enum exists).
-- RPC failed with 42704 type "app_role_v2" does not exist for all users (incl. super_admin).
-- Formulas, signature, search_path, security mode preserved 1:1.

CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_provider text DEFAULT 'bepaid'::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  -- Guard: service_role OR super_admin OR admin. No anon, no plain authenticated.
  IF auth.role() <> 'service_role'
     AND NOT (
       public.has_role_v2(auth.uid(), 'super_admin')
       OR public.has_role_v2(auth.uid(), 'admin')
     ) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
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
  WHERE provider = p_provider
    AND paid_at >= p_from AND paid_at <= p_to;

  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) TO service_role;

INSERT INTO public.audit_logs (actor_type, action, meta)
VALUES (
  'system',
  'payments_stats_rpc_guard_fixed',
  jsonb_build_object(
    'function', 'admin_get_payments_stats_v1',
    'patch', 'PATCH-PAYMENTS-STATS-RPC-GUARD-FIX-2026-05',
    'root_cause', 'guard used non-existent app_role_v2 enum cast (42704); RPC failed for ALL users including super_admin',
    'fix', 'removed ::app_role_v2 cast; widened guard to super_admin OR admin OR service_role',
    'formulas_changed', false,
    'signature_changed', false,
    'applied_at', now()
  )
);
