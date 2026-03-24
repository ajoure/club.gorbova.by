-- INV-22: Fix false positives — filter out auto_renew=false and already-expired subscriptions
CREATE OR REPLACE FUNCTION public.inv22_subscription_desync(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH desync AS (
    SELECT
      s.id AS subscription_id,
      s.user_id,
      s.product_id,
      s.auto_renew,
      ps.state AS ps_state,
      ps.next_charge_at,
      ps.last_charge_at,
      s.access_end_at
    FROM subscriptions_v2 s
    JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
    WHERE s.status = 'active'
      AND s.auto_renew = true
      AND s.access_end_at > now()
      AND (
        ps.state IN ('expired', 'redirecting')
        OR (ps.state = 'active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL)
      )
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM desync),
    'samples', (SELECT coalesce(jsonb_agg(d), '[]'::jsonb) FROM (SELECT * FROM desync LIMIT p_limit) d)
  );
$$;