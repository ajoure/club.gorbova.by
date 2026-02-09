
-- Drop old RPC with different return type
DROP FUNCTION IF EXISTS public.find_wrongly_revoked_users();

-- PATCH P0.9.6-D: RPC find_wrongly_revoked_users with club_id matching
CREATE OR REPLACE FUNCTION public.find_wrongly_revoked_users()
RETURNS TABLE (
  profile_id uuid,
  user_id uuid,
  email text,
  full_name text,
  club_id uuid,
  club_name text,
  member_status text,
  access_source text,
  access_end_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY

  -- Source 1: Active subscriptions → mapped club
  SELECT DISTINCT ON (p.id, tcm.club_id)
    p.id AS profile_id,
    p.user_id,
    p.email,
    p.full_name,
    tcm.club_id,
    tc.club_name,
    tcm.access_status AS member_status,
    'subscription'::text AS access_source,
    s.access_end_at
  FROM subscriptions_v2 s
  JOIN profiles p ON p.user_id = s.user_id
  JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
  JOIN telegram_club_members tcm ON tcm.club_id = pcm.club_id AND tcm.profile_id = p.id
  JOIN telegram_clubs tc ON tc.id = tcm.club_id
  WHERE s.status IN ('active', 'trial', 'past_due')
    AND (s.access_end_at IS NULL OR s.access_end_at > now())
    AND tcm.access_status IN ('removed', 'kicked', 'expired')

  UNION

  -- Source 2: Manual access → direct club_id match
  SELECT DISTINCT ON (p.id, tcm.club_id)
    p.id AS profile_id,
    p.user_id,
    p.email,
    p.full_name,
    tcm.club_id,
    tc.club_name,
    tcm.access_status AS member_status,
    'manual_access'::text AS access_source,
    tma.valid_until AS access_end_at
  FROM telegram_manual_access tma
  JOIN profiles p ON p.user_id = tma.user_id
  JOIN telegram_club_members tcm ON tcm.club_id = tma.club_id AND tcm.profile_id = p.id
  JOIN telegram_clubs tc ON tc.id = tcm.club_id
  WHERE tma.is_active = true
    AND (tma.valid_until IS NULL OR tma.valid_until > now())
    AND tcm.access_status IN ('removed', 'kicked', 'expired')

  ORDER BY profile_id, club_id;
END;
$$;
