-- PATCH 13: Billing Alignment, Notification History, RBAC

-- 13E: Add message_text column to telegram_logs for notification history
ALTER TABLE telegram_logs ADD COLUMN IF NOT EXISTS message_text TEXT;

COMMENT ON COLUMN telegram_logs.message_text IS 
  'Full text of notification sent to user, for history display in Telegram feed';

-- 13A: RPC for billing alignment - find subscriptions with misaligned next_charge_at
CREATE OR REPLACE FUNCTION find_misaligned_subscriptions(p_limit INT DEFAULT 200)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  profile_id UUID,
  status TEXT,
  next_charge_at TIMESTAMPTZ,
  access_end_at TIMESTAMPTZ,
  days_difference INT,
  full_name TEXT,
  email TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.user_id,
    s.profile_id,
    s.status::TEXT,
    s.next_charge_at,
    s.access_end_at,
    EXTRACT(DAY FROM (s.access_end_at - s.next_charge_at))::INT as days_difference,
    p.full_name,
    p.email
  FROM subscriptions_v2 s
  LEFT JOIN profiles p ON p.id = s.profile_id OR p.user_id = s.user_id
  WHERE s.status IN ('active', 'trial', 'past_due')
    AND s.access_end_at > now()
    AND s.next_charge_at IS NOT NULL
    AND s.next_charge_at < s.access_end_at
  ORDER BY (s.access_end_at - s.next_charge_at) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 13D: RPC to find users with a specific permission (for RBAC)
CREATE OR REPLACE FUNCTION find_users_with_permission(permission_code TEXT)
RETURNS TABLE (user_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT urv.user_id
  FROM user_roles_v2 urv
  JOIN role_permissions rp ON rp.role_id = urv.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.code = permission_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 13A: Function to execute billing alignment in batch
CREATE OR REPLACE FUNCTION align_billing_dates(p_batch_size INT DEFAULT 200)
RETURNS TABLE (
  updated_count INT,
  sample_ids UUID[]
) AS $$
DECLARE
  v_count INT;
  v_samples UUID[];
BEGIN
  -- Update subscriptions and collect affected IDs
  WITH updated AS (
    UPDATE subscriptions_v2 s
    SET 
      next_charge_at = s.access_end_at,
      meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object(
        'billing_aligned_at', now()::text,
        'old_next_charge_at', s.next_charge_at::text,
        'aligned_by', 'admin-billing-alignment'
      )
    FROM (
      SELECT id 
      FROM subscriptions_v2
      WHERE status IN ('active', 'trial', 'past_due')
        AND access_end_at > now()
        AND next_charge_at IS NOT NULL
        AND next_charge_at < access_end_at
      ORDER BY (access_end_at - next_charge_at) DESC
      LIMIT p_batch_size
    ) sub
    WHERE s.id = sub.id
    RETURNING s.id
  )
  SELECT COUNT(*)::INT, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 20)
  INTO v_count, v_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM updated) agg;

  RETURN QUERY SELECT COALESCE(v_count, 0), COALESCE(v_samples, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;