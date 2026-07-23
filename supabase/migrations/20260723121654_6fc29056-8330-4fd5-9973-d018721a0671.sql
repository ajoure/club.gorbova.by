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
      AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id)
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN COALESCE(b.meta->>'superseded_by_repair','') <> ''
          OR COALESCE(b.meta->>'no_real_payment','') <> ''
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

UPDATE public.orders_v2
SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
  'superseded_by_repair', 'order:d06aacca-4c3a-464f-972d-81755c500d69',
  'superseded_reason', 'canonical_bepaid_payment_recovered',
  'superseded_at', now()
)
WHERE id = 'fdd412d1-470e-4564-b973-8d3e177ac625'
  AND NOT EXISTS (
    SELECT 1 FROM public.payments_v2 p WHERE p.order_id = orders_v2.id
  )
  AND COALESCE(meta->>'superseded_by_repair', '') = '';