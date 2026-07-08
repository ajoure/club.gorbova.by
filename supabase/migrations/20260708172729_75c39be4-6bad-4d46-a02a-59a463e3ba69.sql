DROP FUNCTION IF EXISTS public.admin_get_telegram_messages_fast_v1(uuid, int);

CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_fast_v1(
  p_user_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  telegram_user_id bigint,
  bot_id uuid,
  message_id bigint,
  direction text,
  message_text text,
  reply_to_message_id bigint,
  sent_by_admin uuid,
  is_read boolean,
  is_pinned boolean,
  is_favorite boolean,
  status text,
  error_message text,
  created_at timestamptz,
  meta jsonb,
  bot_name text,
  bot_username text,
  admin_full_name text,
  admin_avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.user_id,
    m.telegram_user_id,
    m.bot_id,
    m.message_id,
    m.direction,
    m.message_text,
    m.reply_to_message_id,
    m.sent_by_admin,
    m.is_read,
    m.is_pinned,
    m.is_favorite,
    m.status,
    m.error_message,
    m.created_at,
    m.meta,
    b.bot_name,
    b.bot_username,
    ap.full_name  AS admin_full_name,
    ap.avatar_url AS admin_avatar_url
  FROM public.telegram_messages m
  LEFT JOIN public.telegram_bots b ON b.id = m.bot_id
  LEFT JOIN public.profiles      ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
    )
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) TO service_role;