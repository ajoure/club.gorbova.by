-- PATCH 10G: Add attempt_count to notification_outbox for retry logic
ALTER TABLE public.notification_outbox 
ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 1;

ALTER TABLE public.notification_outbox 
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ DEFAULT now();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notification_outbox_idempotency 
ON public.notification_outbox(idempotency_key);

-- PATCH 10J: RPC function to find false revoke notifications (checks status AT TIME of notification)
CREATE OR REPLACE FUNCTION public.find_false_revoke_notifications(since_timestamp timestamptz)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  telegram_user_id bigint,
  notification_count bigint,
  last_notification_at timestamptz,
  sub_status text,
  access_end_at timestamptz
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    tl.user_id,
    p.full_name,
    p.email,
    p.telegram_user_id,
    COUNT(*)::bigint as notification_count,
    MAX(tl.created_at) as last_notification_at,
    s.status as sub_status,
    s.access_end_at
  FROM telegram_logs tl
  JOIN profiles p ON p.user_id = tl.user_id
  JOIN subscriptions_v2 s ON s.user_id = tl.user_id
  WHERE tl.action = 'manual_notification'
    AND tl.status = 'success'
    AND tl.meta->>'message_type' = 'access_revoked'
    AND tl.created_at >= since_timestamp
    -- Подписка была активна НА МОМЕНТ уведомления (ключевое условие)
    AND s.status IN ('active', 'trial')
    AND s.access_end_at > tl.created_at
  GROUP BY tl.user_id, p.full_name, p.email, p.telegram_user_id, s.status, s.access_end_at
$$;

-- PATCH 11C: RPC function to find wrongly revoked users (active access but not in TG)
CREATE OR REPLACE FUNCTION public.find_wrongly_revoked_users()
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
  club_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (s.user_id)
    s.user_id,
    p.id as profile_id,
    p.full_name,
    p.email,
    p.telegram_user_id,
    s.status,
    s.access_end_at,
    tcm.in_chat,
    tcm.access_status,
    tcm.club_id
  FROM subscriptions_v2 s
  JOIN profiles p ON p.user_id = s.user_id
  LEFT JOIN telegram_club_members tcm ON tcm.profile_id = p.id
  WHERE s.status IN ('active', 'trial', 'past_due')
    AND s.access_end_at > now()
    AND p.telegram_user_id IS NOT NULL
    AND (
      tcm.in_chat = false 
      OR tcm.access_status = 'removed' 
      OR tcm.id IS NULL
    )
  ORDER BY s.user_id, s.access_end_at DESC
$$;