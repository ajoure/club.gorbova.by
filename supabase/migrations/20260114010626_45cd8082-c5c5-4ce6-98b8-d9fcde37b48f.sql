-- STEP 3: Backfill entitlements for eligible paid orders
-- Using DISTINCT ON to avoid duplicate user_id+product_code conflicts
-- Takes the most recent order for each user+product combination

INSERT INTO entitlements (user_id, profile_id, order_id, product_code, status, expires_at, meta)
SELECT 
  user_id,
  profile_id,
  order_id,
  product_code,
  'active',
  expires_at,
  jsonb_build_object('source','backfill_20260114','order_number',order_number)
FROM (
  SELECT DISTINCT ON (o.user_id, COALESCE(p.code, 'club'))
    o.user_id,
    COALESCE(o.profile_id, pr.id) as profile_id,
    o.id as order_id,
    COALESCE(p.code, 'club') as product_code,
    COALESCE(s.access_end_at, NOW() + INTERVAL '30 days') as expires_at,
    o.order_number
  FROM orders_v2 o
  JOIN products_v2 p ON p.id = o.product_id
  LEFT JOIN subscriptions_v2 s ON s.order_id = o.id
  JOIN profiles pr ON pr.user_id = o.user_id
  WHERE o.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.order_id = o.id)
  ORDER BY o.user_id, COALESCE(p.code, 'club'), COALESCE(s.access_end_at, o.created_at) DESC
) sub
ON CONFLICT (user_id, product_code) DO UPDATE SET
  expires_at = GREATEST(entitlements.expires_at, EXCLUDED.expires_at),
  status     = 'active',
  updated_at = NOW();