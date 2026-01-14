-- STEP 4: Обновить expires_at для заказов, где уже есть entitlement по user_id+product_code
-- Продлеваем expires_at до максимального значения из всех оплаченных заказов

WITH orders_with_access AS (
  SELECT DISTINCT ON (o.user_id, COALESCE(p.code, 'club'))
    o.user_id,
    COALESCE(p.code, 'club') as product_code,
    GREATEST(s.access_end_at, NOW() + INTERVAL '30 days') as max_expires_at
  FROM orders_v2 o
  JOIN products_v2 p ON p.id = o.product_id
  LEFT JOIN subscriptions_v2 s ON s.order_id = o.id
  WHERE o.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.order_id = o.id)
  ORDER BY o.user_id, COALESCE(p.code, 'club'), COALESCE(s.access_end_at, o.created_at) DESC
)
UPDATE entitlements e
SET expires_at = GREATEST(e.expires_at, oa.max_expires_at),
    updated_at = NOW()
FROM orders_with_access oa
WHERE e.user_id = oa.user_id 
  AND e.product_code = oa.product_code
  AND e.expires_at < oa.max_expires_at;