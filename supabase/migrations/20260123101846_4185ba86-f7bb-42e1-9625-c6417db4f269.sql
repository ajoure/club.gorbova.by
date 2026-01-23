-- PATCH 14.4: Очистить дублирующиеся функции find_wrongly_revoked_users

-- Удалить все версии функции
DROP FUNCTION IF EXISTS find_wrongly_revoked_users();
DROP FUNCTION IF EXISTS find_wrongly_revoked_users(text);

-- Создать единственную правильную версию
CREATE FUNCTION find_wrongly_revoked_users()
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  telegram_user_id bigint,
  status text,
  access_end_at timestamptz,
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
    -- Источник 1: subscriptions_v2 с активным статусом
    SELECT DISTINCT
      s.user_id,
      s.access_end_at,
      'subscription'::text as source
    FROM subscriptions_v2 s
    WHERE s.status IN ('active', 'trial', 'pending_cancellation', 'past_due')
      AND s.access_end_at > now()
    
    UNION
    
    -- Источник 2: entitlements с product_code = 'club' и status = 'active'
    SELECT DISTINCT
      e.user_id,
      COALESCE(e.expires_at, now() + interval '1 year') as access_end_at,
      'entitlement'::text as source
    FROM entitlements e
    WHERE e.product_code = 'club'
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    
    UNION
    
    -- Источник 3: telegram_manual_access с активным доступом
    SELECT DISTINCT
      p.user_id,
      tma.access_end_at,
      'manual_access'::text as source
    FROM telegram_manual_access tma
    JOIN profiles p ON p.id = tma.profile_id
    WHERE tma.is_active = true
      AND tma.access_end_at > now()
  ),
  -- Находим пользователей, которые имеют активный доступ, но kicked из Telegram
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
       OR tcm.in_chat = false
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