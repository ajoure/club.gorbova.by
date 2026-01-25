-- ========================================
-- PATCH: Fix find_wrongly_revoked_users + Add find_bought_not_joined_users
-- ========================================

-- 1. FIX: find_wrongly_revoked_users()
-- Remove OR in_chat=false, keep only real revoked statuses
-- Exclude staff emails, handle NULL expires correctly
CREATE OR REPLACE FUNCTION public.find_wrongly_revoked_users()
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  telegram_user_id bigint,
  status text,
  access_end_at timestamp with time zone,
  in_chat boolean,
  access_status text,
  club_id uuid,
  access_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH active_access AS (
    -- Source 1: subscriptions_v2 with active status
    SELECT DISTINCT
      s.user_id,
      s.access_end_at,
      'subscription'::text as source
    FROM subscriptions_v2 s
    WHERE s.status IN ('active', 'trial', 'past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
    
    UNION
    
    -- Source 2: entitlements with product_code = 'club' and status = 'active'
    SELECT DISTINCT
      e.user_id,
      COALESCE(e.expires_at, now() + interval '1 year') as access_end_at,
      'entitlement'::text as source
    FROM entitlements e
    WHERE e.product_code = 'club'
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    
    UNION
    
    -- Source 3: telegram_manual_access with active access
    SELECT DISTINCT
      tma.user_id,
      tma.valid_until as access_end_at,
      'manual_access'::text as source
    FROM telegram_manual_access tma
    WHERE tma.is_active = true
      AND (tma.valid_until IS NULL OR tma.valid_until > now())
  ),
  -- Find users who have active access BUT are kicked/removed from Telegram
  -- ✅ FIXED: Removed "OR tcm.in_chat = false" - that's bought_not_joined, NOT wrongly_revoked
  wrongly_revoked AS (
    SELECT 
      aa.user_id,
      aa.access_end_at,
      aa.source,
      tcm.club_id,
      tcm.telegram_user_id,
      tcm.in_chat,
      tcm.access_status
    FROM active_access aa
    JOIN profiles p ON p.user_id = aa.user_id
    JOIN telegram_club_members tcm ON tcm.profile_id = p.id
    WHERE tcm.access_status IN ('removed', 'kicked', 'expired')
      -- ✅ Staff exclusion
      AND p.email NOT IN (
        'a.bruylo@ajoure.by',
        'nrokhmistrov@gmail.com',
        'ceo@ajoure.by',
        'irenessa@yandex.ru'
      )
  )
  SELECT 
    wr.user_id,
    p.id as profile_id,
    p.full_name::text,
    p.email::text,
    wr.telegram_user_id,
    wr.access_status::text as status,
    wr.access_end_at,
    wr.in_chat,
    wr.access_status::text,
    wr.club_id,
    wr.source as access_source
  FROM wrongly_revoked wr
  JOIN profiles p ON p.user_id = wr.user_id
  WHERE wr.telegram_user_id IS NOT NULL;
END;
$$;

-- Security: Revoke public access
REVOKE ALL ON FUNCTION public.find_wrongly_revoked_users() FROM PUBLIC;

-- ========================================
-- 2. NEW: find_bought_not_joined_users()
-- Users with active access who haven't joined Telegram yet
-- ========================================
CREATE OR REPLACE FUNCTION public.find_bought_not_joined_users()
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  email text,
  full_name text,
  telegram_user_id bigint,
  access_source text,
  access_end_at timestamp with time zone,
  invite_sent_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH active_access AS (
    -- Source 1: subscriptions_v2
    SELECT s.user_id, s.access_end_at, 'subscription'::text AS source
    FROM subscriptions_v2 s
    WHERE s.status IN ('active', 'trial', 'past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > now())

    UNION

    -- Source 2: entitlements
    SELECT e.user_id, e.expires_at, 'entitlement'::text
    FROM entitlements e
    WHERE e.status = 'active'
      AND e.product_code = 'club'
      AND (e.expires_at IS NULL OR e.expires_at > now())

    UNION

    -- Source 3: manual_access
    SELECT tma.user_id, tma.valid_until, 'manual_access'::text
    FROM telegram_manual_access tma
    WHERE tma.is_active = true
      AND (tma.valid_until IS NULL OR tma.valid_until > now())
  )
  SELECT
    aa.user_id,
    p.id as profile_id,
    p.email::text,
    p.full_name::text,
    tcm.telegram_user_id,
    STRING_AGG(DISTINCT aa.source, ', ') AS access_source,
    MIN(aa.access_end_at) AS access_end_at,
    tcm.invite_sent_at,
    tcm.created_at
  FROM active_access aa
  JOIN profiles p ON p.user_id = aa.user_id
  JOIN telegram_club_members tcm ON tcm.profile_id = p.id
  WHERE tcm.access_status = 'ok'      -- ✅ Access granted
    AND tcm.in_chat = false           -- ✅ But not joined yet
    AND tcm.telegram_user_id IS NOT NULL
    -- ✅ Staff exclusion
    AND p.email NOT IN (
      'a.bruylo@ajoure.by',
      'nrokhmistrov@gmail.com',
      'ceo@ajoure.by',
      'irenessa@yandex.ru'
    )
  GROUP BY aa.user_id, p.id, p.email, p.full_name,
           tcm.telegram_user_id, tcm.invite_sent_at, tcm.created_at
  ORDER BY access_end_at ASC NULLS LAST;
END;
$$;

-- Security: Revoke public access
REVOKE ALL ON FUNCTION public.find_bought_not_joined_users() FROM PUBLIC;