-- =====================================================
-- SQL Functions for Cleanup Operations (security definer)
-- =====================================================

-- =====================================================
-- A1. Corruption Fix: Update grants where user_id = profile.id -> profile.user_id
-- Returns count of fixed records
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_telegram_corruption_fix(p_execute boolean DEFAULT false)
RETURNS TABLE(fixed_count int, sample_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_samples uuid[];
BEGIN
  -- Get count and samples of corrupted records
  WITH corrupted AS (
    SELECT g.id, p.user_id AS correct_auth_user_id
    FROM telegram_access_grants g
    JOIN profiles p ON p.id = g.user_id
    WHERE g.user_id IS NOT NULL
      AND p.user_id IS NOT NULL
      AND g.user_id != p.user_id
  )
  SELECT count(*)::int, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 20)
  INTO v_count, v_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM corrupted) sub;

  IF p_execute AND v_count > 0 THEN
    -- Execute the fix with CTE
    WITH corrupted AS (
      SELECT g.id, p.user_id AS correct_auth_user_id
      FROM telegram_access_grants g
      JOIN profiles p ON p.id = g.user_id
      WHERE g.user_id IS NOT NULL
        AND p.user_id IS NOT NULL
        AND g.user_id != p.user_id
    )
    UPDATE telegram_access_grants g
    SET user_id = c.correct_auth_user_id
    FROM corrupted c
    WHERE g.id = c.id;
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_samples, ARRAY[]::uuid[]);
END;
$$;

-- =====================================================
-- A2. Orphan Delete: Delete records where user_id not in auth.users AND not in profiles
-- Returns count of deleted records
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_telegram_orphans_delete(p_execute boolean DEFAULT false)
RETURNS TABLE(grants_count int, access_count int, grant_samples uuid[], access_samples uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grants_count int;
  v_access_count int;
  v_grant_samples uuid[];
  v_access_samples uuid[];
BEGIN
  -- Count and sample orphan grants (user_id not in profiles.user_id and not in profiles.id)
  WITH orphan_grants AS (
    SELECT g.id
    FROM telegram_access_grants g
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = g.user_id)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = g.user_id)
  )
  SELECT count(*)::int, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 10)
  INTO v_grants_count, v_grant_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM orphan_grants) sub;

  -- Count and sample orphan access
  WITH orphan_access AS (
    SELECT a.id
    FROM telegram_access a
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = a.user_id)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.user_id)
  )
  SELECT count(*)::int, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 10)
  INTO v_access_count, v_access_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM orphan_access) sub;

  IF p_execute THEN
    -- Delete orphan grants
    DELETE FROM telegram_access_grants g
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = g.user_id)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = g.user_id);

    -- Delete orphan access
    DELETE FROM telegram_access a
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = a.user_id)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.user_id);
  END IF;

  RETURN QUERY SELECT 
    v_grants_count, 
    v_access_count, 
    COALESCE(v_grant_samples, ARRAY[]::uuid[]),
    COALESCE(v_access_samples, ARRAY[]::uuid[]);
END;
$$;

-- =====================================================
-- A3. Expired Pending Tokens Delete
-- Returns count of deleted tokens
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_telegram_expired_tokens(p_execute boolean DEFAULT false)
RETURNS TABLE(deleted_count int, sample_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_samples uuid[];
BEGIN
  -- Count expired tokens
  WITH expired_tokens AS (
    SELECT id FROM telegram_link_tokens
    WHERE status = 'pending' 
      AND expires_at IS NOT NULL 
      AND expires_at < now()
    UNION ALL
    SELECT id FROM telegram_link_tokens
    WHERE status = 'pending' 
      AND expires_at IS NULL 
      AND created_at < now() - interval '7 days'
  )
  SELECT count(*)::int, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 20)
  INTO v_count, v_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM expired_tokens) sub;

  IF p_execute AND v_count > 0 THEN
    -- Delete expired tokens with expires_at
    DELETE FROM telegram_link_tokens
    WHERE status = 'pending' 
      AND expires_at IS NOT NULL 
      AND expires_at < now();

    -- Delete old pending tokens without expires_at
    DELETE FROM telegram_link_tokens
    WHERE status = 'pending' 
      AND expires_at IS NULL 
      AND created_at < now() - interval '7 days';
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_samples, ARRAY[]::uuid[]);
END;
$$;

-- =====================================================
-- B1. Demo Contacts Safeguard Check
-- Returns counts for orders, payments, non-revoked entitlements
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_demo_safeguard_check()
RETURNS TABLE(orders_count int, payments_count int, entitlements_nonrevoked_count int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH demo_profiles AS (
    SELECT profile_id FROM get_demo_profile_ids()
  )
  SELECT 
    (SELECT count(*)::int FROM orders_v2 WHERE profile_id IN (SELECT profile_id FROM demo_profiles)),
    (SELECT count(*)::int FROM payments_v2 WHERE profile_id IN (SELECT profile_id FROM demo_profiles)),
    (SELECT count(*)::int FROM entitlements WHERE profile_id IN (SELECT profile_id FROM demo_profiles) AND status != 'revoked');
$$;

-- =====================================================
-- B2. Demo Entitlements Delete: revoked AND (order_id IS NULL OR order missing)
-- Returns count and sample of deleted entitlements
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_demo_entitlements(p_execute boolean DEFAULT false)
RETURNS TABLE(deleted_count int, sample_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_samples uuid[];
BEGIN
  -- Count entitlements to delete: revoked AND (order_id IS NULL OR order not exists)
  WITH demo_profiles AS (
    SELECT profile_id FROM get_demo_profile_ids()
  ),
  entitlements_to_delete AS (
    SELECT e.id
    FROM entitlements e
    WHERE e.profile_id IN (SELECT profile_id FROM demo_profiles)
      AND e.status = 'revoked'
      AND (e.order_id IS NULL OR NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = e.order_id))
  )
  SELECT count(*)::int, array_agg(id ORDER BY id) FILTER (WHERE row_num <= 20)
  INTO v_count, v_samples
  FROM (SELECT *, row_number() OVER () as row_num FROM entitlements_to_delete) sub;

  IF p_execute AND v_count > 0 THEN
    WITH demo_profiles AS (
      SELECT profile_id FROM get_demo_profile_ids()
    )
    DELETE FROM entitlements e
    WHERE e.profile_id IN (SELECT profile_id FROM demo_profiles)
      AND e.status = 'revoked'
      AND (e.order_id IS NULL OR NOT EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = e.order_id));
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_samples, ARRAY[]::uuid[]);
END;
$$;

-- =====================================================
-- B3. Demo Related Tables Counts (for dry-run)
-- Returns counts for all demo-related tables
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_demo_counts()
RETURNS TABLE(
  telegram_link_tokens_count int,
  telegram_access_grants_count int,
  telegram_access_count int,
  telegram_club_members_count int,
  pending_notifications_count int,
  user_roles_count int,
  consent_logs_count int,
  profiles_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH demo AS (
    SELECT profile_id, auth_user_id FROM get_demo_profile_ids()
  ),
  demo_user_ids AS (
    SELECT auth_user_id FROM demo WHERE auth_user_id IS NOT NULL
  ),
  demo_profile_ids AS (
    SELECT profile_id FROM demo
  )
  SELECT 
    (SELECT count(*)::int FROM telegram_link_tokens WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM telegram_access_grants WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM telegram_access WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM telegram_club_members WHERE profile_id IN (SELECT profile_id FROM demo_profile_ids)),
    (SELECT count(*)::int FROM pending_telegram_notifications WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM user_roles_v2 WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM consent_logs WHERE user_id IN (SELECT auth_user_id FROM demo_user_ids)),
    (SELECT count(*)::int FROM demo_profile_ids);
$$;

-- =====================================================
-- B4. Demo Delete All Related Tables (except auth.users which needs Admin API)
-- Deletes in cascade order, returns counts
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_demo_delete_all()
RETURNS TABLE(
  telegram_link_tokens_deleted int,
  telegram_access_grants_deleted int,
  telegram_access_deleted int,
  telegram_club_members_deleted int,
  pending_notifications_deleted int,
  user_roles_deleted int,
  consent_logs_deleted int,
  profiles_deleted int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens int := 0;
  v_grants int := 0;
  v_access int := 0;
  v_members int := 0;
  v_notifications int := 0;
  v_roles int := 0;
  v_consent int := 0;
  v_profiles int := 0;
BEGIN
  -- Get demo IDs
  CREATE TEMP TABLE temp_demo_ids AS
    SELECT profile_id, auth_user_id FROM get_demo_profile_ids();

  -- 1. telegram_link_tokens
  WITH deleted AS (
    DELETE FROM telegram_link_tokens 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_tokens FROM deleted;

  -- 2. telegram_access_grants
  WITH deleted AS (
    DELETE FROM telegram_access_grants 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_grants FROM deleted;

  -- 3. telegram_access
  WITH deleted AS (
    DELETE FROM telegram_access 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_access FROM deleted;

  -- 4. telegram_club_members
  WITH deleted AS (
    DELETE FROM telegram_club_members 
    WHERE profile_id IN (SELECT profile_id FROM temp_demo_ids)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_members FROM deleted;

  -- 5. pending_telegram_notifications
  WITH deleted AS (
    DELETE FROM pending_telegram_notifications 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_notifications FROM deleted;

  -- 6. user_roles_v2
  WITH deleted AS (
    DELETE FROM user_roles_v2 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_roles FROM deleted;

  -- 7. consent_logs
  WITH deleted AS (
    DELETE FROM consent_logs 
    WHERE user_id IN (SELECT auth_user_id FROM temp_demo_ids WHERE auth_user_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_consent FROM deleted;

  -- 8. profiles
  WITH deleted AS (
    DELETE FROM profiles 
    WHERE id IN (SELECT profile_id FROM temp_demo_ids)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_profiles FROM deleted;

  DROP TABLE temp_demo_ids;

  RETURN QUERY SELECT v_tokens, v_grants, v_access, v_members, v_notifications, v_roles, v_consent, v_profiles;
END;
$$;