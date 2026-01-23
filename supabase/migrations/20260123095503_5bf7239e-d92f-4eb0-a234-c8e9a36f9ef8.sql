-- PATCH 13.6: Привязать payment_method к orphan-подпискам
-- Для каждой подписки с auto_renew=true и payment_method_id=NULL
-- найти активную карту того же пользователя и привязать

WITH orphan_subs AS (
  SELECT 
    s.id AS sub_id,
    s.user_id,
    pm.id AS pm_id
  FROM subscriptions_v2 s
  JOIN LATERAL (
    SELECT id 
    FROM payment_methods 
    WHERE user_id = s.user_id 
      AND status = 'active'
    ORDER BY is_default DESC, created_at DESC
    LIMIT 1
  ) pm ON true
  WHERE s.auto_renew = true
    AND s.payment_method_id IS NULL
    AND s.status IN ('active', 'trial')
)
UPDATE subscriptions_v2
SET payment_method_id = orphan_subs.pm_id
FROM orphan_subs
WHERE subscriptions_v2.id = orphan_subs.sub_id;