-- INV-20 must never treat a soft-deleted payment as payment evidence.
-- The parent-payment link for a composable child is valid only while the
-- referenced payment is active. The same rule applies when deciding whether
-- a paid order already has its own canonical payment.
CREATE OR REPLACE FUNCTION public.inv20_paid_orders_actionable(
  p_since timestamp with time zone DEFAULT (now() - interval '30 days'),
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT o.id, o.order_number, o.created_at, o.user_id, o.provider,
           o.reconcile_source, o.bepaid_subscription_id, o.meta,
           o.final_price, o.paid_amount
    FROM orders_v2 o
    WHERE o.status = 'paid'
      AND o.created_at >= p_since
      AND NOT EXISTS (
        SELECT 1
        FROM payments_v2 p
        WHERE p.order_id = o.id
          AND COALESCE(p.is_deleted, false) = false
      )
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN COALESCE(b.meta->>'superseded_by_repair','') <> ''
          OR COALESCE(b.meta->>'no_real_payment','') <> ''
          THEN 'suppressed'
        WHEN lower(COALESCE(b.meta->>'group_child_order', 'false')) = 'true'
          AND COALESCE(b.meta->>'group_payment_id', '') <> ''
          AND COALESCE(b.meta->>'group_primary_order_id', '') <> ''
          AND COALESCE(b.meta->>'order_group_id', '') <> ''
          AND EXISTS (
            SELECT 1
            FROM payments_v2 group_payment
            JOIN order_groups payment_group
              ON lower(payment_group.id::text) = lower(b.meta->>'order_group_id')
            JOIN order_group_items group_item
              ON group_item.order_group_id = payment_group.id
             AND group_item.order_id = b.id
             AND group_item.role = 'addon'
            WHERE lower(group_payment.id::text) = lower(b.meta->>'group_payment_id')
              AND lower(group_payment.order_id::text) = lower(b.meta->>'group_primary_order_id')
              AND lower(payment_group.primary_order_id::text) = lower(b.meta->>'group_primary_order_id')
              AND group_payment.user_id IS NOT DISTINCT FROM b.user_id
              AND payment_group.user_id IS NOT DISTINCT FROM b.user_id
              AND group_payment.status::text = 'succeeded'
              AND COALESCE(group_payment.is_deleted, false) = false
              AND payment_group.status::text = 'paid'
          )
          THEN 'suppressed'
        WHEN lower(COALESCE(b.provider, '')) IN ('rr','manual','test','admin')
          OR lower(COALESCE(b.meta->>'source', '')) IN ('trial_no_card','trial','probe')
          OR COALESCE(b.final_price, 0) = 0
          OR b.reconcile_source IN ('getcourse_historical','rule_engine','bepaid_archive_import')
          OR b.order_number LIKE 'MIG-%'
          OR b.order_number LIKE 'MANUAL-RESTORE-%'
          THEN 'synthetic'
        WHEN b.user_id IS NULL
          THEN 'orphan'
        ELSE 'actionable'
      END AS bucket
    FROM base b
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE bucket = 'actionable')::bigint AS actionable_count,
      count(*) FILTER (WHERE bucket = 'orphan')::bigint AS orphan_count,
      count(*) FILTER (WHERE bucket = 'synthetic')::bigint AS synthetic_count,
      count(*) FILTER (WHERE bucket = 'suppressed')::bigint AS suppressed_count,
      count(*)::bigint AS total
    FROM classified
  ),
  samples AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'order_number', order_number, 'created_at', created_at,
      'provider', provider, 'reconcile_source', reconcile_source
    ) ORDER BY created_at DESC) AS items
    FROM (
      SELECT * FROM classified WHERE bucket = 'actionable'
      ORDER BY created_at DESC LIMIT p_limit
    ) s
  )
  SELECT jsonb_build_object(
    'actionable_count', c.actionable_count,
    'orphan_count', c.orphan_count,
    'synthetic_count', c.synthetic_count,
    'suppressed_count', c.suppressed_count,
    'total', c.total,
    'window_days', 30,
    'samples', COALESCE((SELECT items FROM samples), '[]'::jsonb)
  )
  FROM counts c;
$$;

REVOKE EXECUTE ON FUNCTION public.inv20_paid_orders_actionable(timestamp with time zone, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv20_paid_orders_actionable(timestamp with time zone, integer)
  TO service_role;
