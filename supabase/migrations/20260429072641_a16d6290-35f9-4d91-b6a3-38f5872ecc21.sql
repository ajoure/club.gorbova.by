CREATE OR REPLACE FUNCTION public.inv22_subscription_desync(p_limit int DEFAULT 50)
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
      s.tariff_id,
      s.auto_renew,
      s.access_end_at,
      s.created_at AS s_created_at,
      ps.id AS provider_subscription_row_id,
      ps.provider,
      ps.provider_subscription_id,
      ps.state AS ps_state,
      ps.next_charge_at AS ps_next_charge_at,
      ps.last_charge_at AS ps_last_charge_at,
      ps.updated_at AS ps_updated_at,
      EXTRACT(EPOCH FROM (now() - s.created_at)) / 3600.0 AS age_hours,
      CASE
        WHEN ps.state = 'expired'     AND ps.last_charge_at IS NULL THEN 'never_charged_expired'
        WHEN ps.state = 'expired'                                  THEN 'previously_charged_expired'
        WHEN ps.state = 'redirecting' AND ps.last_charge_at IS NULL THEN 'never_charged_redirecting'
        WHEN ps.state = 'redirecting'                              THEN 'previously_charged_redirecting'
        WHEN ps.state = 'active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL THEN 'active_no_dates'
        ELSE 'other'
      END AS bucket
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
    'count',     (SELECT count(*) FROM desync),
    'by_bucket', (
      SELECT coalesce(jsonb_object_agg(bucket, cnt), '{}'::jsonb)
      FROM (SELECT bucket, count(*)::int AS cnt FROM desync GROUP BY bucket) b
    ),
    'samples', (
      SELECT coalesce(jsonb_agg(d ORDER BY d.access_end_at), '[]'::jsonb)
      FROM (SELECT * FROM desync ORDER BY access_end_at LIMIT p_limit) d
    )
  );
$$;

REVOKE ALL ON FUNCTION public.inv22_subscription_desync(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv22_subscription_desync(int) TO service_role;