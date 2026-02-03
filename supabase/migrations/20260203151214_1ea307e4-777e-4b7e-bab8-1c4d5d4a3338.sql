-- Восстановить profile_id из связанного order_v2
UPDATE payments_v2 p
SET profile_id = o.profile_id
FROM orders_v2 o
WHERE p.order_id = o.id
  AND p.profile_id IS NULL
  AND o.profile_id IS NOT NULL;

-- Для платежей без order_id или где order не имеет profile — найти profile по user_id
UPDATE payments_v2 p
SET profile_id = pr.id
FROM profiles pr
WHERE p.user_id = pr.user_id
  AND p.profile_id IS NULL
  AND pr.id IS NOT NULL;