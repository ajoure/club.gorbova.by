
-- Restore EXECUTE grant + internal super_admin guard for admin_get_payments_stats_v1
-- Root cause: migration 20260202222330 revoked EXECUTE from authenticated; later
-- CREATE OR REPLACE in 20260205094248 did not re-grant it. Frontend hook
-- usePaymentsServerStats calls this RPC under authenticated JWT → permission denied →
-- blue stats panel rendered all zeros despite real data.

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
  -- Internal guard: only super_admin via authenticated JWT, or service_role,
  -- may execute this stats RPC. Keeps default-deny posture while restoring UI.
  IF auth.role() <> 'service_role'
     AND NOT public.has_role_v2(auth.uid(), 'super_admin'::app_role_v2) THEN
    RAISE EXCEPTION 'forbidden: super_admin role required'
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

GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) TO service_role;

INSERT INTO public.audit_logs (actor_type, action, meta)
VALUES (
  'system',
  'restore_admin_payments_stats_grant',
  jsonb_build_object(
    'function', 'admin_get_payments_stats_v1',
    'reason', 'EXECUTE for authenticated was revoked in 20260202222330 and not restored in 20260205094248; UI stats panel showed zeros',
    'previous_revoke_migration', '20260202222330_d045ee33',
    'guard_added', 'super_admin (has_role_v2) OR service_role',
    'applied_at', now()
  )
);
