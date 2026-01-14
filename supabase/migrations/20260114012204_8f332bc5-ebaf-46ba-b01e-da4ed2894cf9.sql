-- Backfill entitlement_orders: link all paid orders to their entitlements
-- Uses GREATEST(expires_at) for upsert

-- Step 1: For orders that already have entitlements, just create the link
INSERT INTO public.entitlement_orders (order_id, entitlement_id, user_id, product_code, meta)
SELECT 
  o.id as order_id,
  e.id as entitlement_id,
  o.user_id,
  COALESCE(p.code, 'club') as product_code,
  jsonb_build_object(
    'source', 'backfill_20260114',
    'order_number', o.order_number,
    'access_end_at', COALESCE(s.access_end_at, NOW() + INTERVAL '30 days')
  ) as meta
FROM orders_v2 o
JOIN products_v2 p ON p.id = o.product_id
JOIN profiles pr ON pr.user_id = o.user_id
JOIN entitlements e ON e.user_id = o.user_id AND e.product_code = COALESCE(p.code, 'club')
LEFT JOIN subscriptions_v2 s ON s.order_id = o.id
WHERE o.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM entitlement_orders eo WHERE eo.order_id = o.id)
ON CONFLICT (order_id) DO NOTHING;

-- Step 2: Update entitlements.expires_at to GREATEST of all linked orders
WITH max_expires AS (
  SELECT 
    eo.entitlement_id,
    MAX(COALESCE((eo.meta->>'access_end_at')::timestamptz, NOW() + INTERVAL '30 days')) as max_access_end
  FROM entitlement_orders eo
  GROUP BY eo.entitlement_id
)
UPDATE entitlements e
SET 
  expires_at = GREATEST(e.expires_at, me.max_access_end),
  updated_at = NOW()
FROM max_expires me
WHERE e.id = me.entitlement_id
  AND (e.expires_at IS NULL OR e.expires_at < me.max_access_end);