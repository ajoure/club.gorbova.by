-- INV-22 must be subscription-scoped, not provider-row-scoped.
-- A stale/abandoned bePaid checkout must never make a currently paid
-- subscription look dead when another linked bePaid subscription is alive.
CREATE OR REPLACE FUNCTION public.inv22_subscription_desync(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH candidates AS (
    SELECT
      s.id AS subscription_id,
      s.user_id,
      s.product_id,
      s.tariff_id,
      s.auto_renew,
      s.access_end_at,
      s.created_at AS s_created_at
    FROM subscriptions_v2 s
    WHERE s.status = 'active'
      AND s.auto_renew = true
      AND s.access_end_at > now()
      AND EXISTS (
        SELECT 1
        FROM provider_subscriptions dead
        WHERE dead.subscription_v2_id = s.id
          AND dead.provider = 'bepaid'
          AND (
            dead.state IN ('expired', 'redirecting')
            OR (dead.state = 'active' AND dead.next_charge_at IS NULL AND dead.last_charge_at IS NULL)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM provider_subscriptions live
        WHERE live.subscription_v2_id = s.id
          AND live.provider = 'bepaid'
          AND live.state = 'active'
          AND (live.next_charge_at IS NOT NULL OR live.last_charge_at IS NOT NULL)
      )
  ), desync AS (
    SELECT
      c.*,
      representative.id AS provider_subscription_row_id,
      representative.provider,
      representative.provider_subscription_id,
      representative.state AS ps_state,
      representative.next_charge_at AS ps_next_charge_at,
      representative.last_charge_at AS ps_last_charge_at,
      representative.updated_at AS ps_updated_at,
      EXTRACT(EPOCH FROM (now() - c.s_created_at)) / 3600.0 AS age_hours,
      CASE
        WHEN representative.state = 'expired' AND representative.last_charge_at IS NULL THEN 'never_charged_expired'
        WHEN representative.state = 'expired' THEN 'previously_charged_expired'
        WHEN representative.state = 'redirecting' AND representative.last_charge_at IS NULL THEN 'never_charged_redirecting'
        WHEN representative.state = 'redirecting' THEN 'previously_charged_redirecting'
        WHEN representative.state = 'active' AND representative.next_charge_at IS NULL AND representative.last_charge_at IS NULL THEN 'active_no_dates'
        ELSE 'other'
      END AS bucket,
      dead_rows.rows AS dead_provider_subscriptions
    FROM candidates c
    CROSS JOIN LATERAL (
      SELECT ps.*
      FROM provider_subscriptions ps
      WHERE ps.subscription_v2_id = c.subscription_id
        AND ps.provider = 'bepaid'
        AND (
          ps.state IN ('expired', 'redirecting')
          OR (ps.state = 'active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL)
        )
      ORDER BY ps.updated_at DESC NULLS LAST, ps.id
      LIMIT 1
    ) representative
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'provider_subscription_row_id', ps.id,
        'provider_subscription_id', ps.provider_subscription_id,
        'state', ps.state,
        'last_charge_at', ps.last_charge_at,
        'next_charge_at', ps.next_charge_at
      ) ORDER BY ps.updated_at DESC NULLS LAST, ps.id) AS rows
      FROM provider_subscriptions ps
      WHERE ps.subscription_v2_id = c.subscription_id
        AND ps.provider = 'bepaid'
        AND (
          ps.state IN ('expired', 'redirecting')
          OR (ps.state = 'active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL)
        )
    ) dead_rows
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM desync),
    'by_bucket', (
      SELECT coalesce(jsonb_object_agg(bucket, cnt), '{}'::jsonb)
      FROM (SELECT bucket, count(*)::int AS cnt FROM desync GROUP BY bucket) b
    ),
    'samples', (
      SELECT coalesce(jsonb_agg(d ORDER BY d.access_end_at, d.subscription_id), '[]'::jsonb)
      FROM (SELECT * FROM desync ORDER BY access_end_at, subscription_id LIMIT p_limit) d
    )
  );
$$;

REVOKE ALL ON FUNCTION public.inv22_subscription_desync(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv22_subscription_desync(int) TO service_role;
