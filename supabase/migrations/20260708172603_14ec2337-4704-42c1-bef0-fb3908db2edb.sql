-- 1) RPC: fast admin read of last N telegram_messages for a dialog
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
  -- normalized media fields lifted out of meta jsonb
  file_type text,
  storage_bucket text,
  storage_path text,
  file_url text,
  file_name text,
  file_size bigint,
  mime_type text,
  duration numeric,
  thumbnail_url text,
  automated boolean,
  source text,
  upload_status text,
  -- flattened joins
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
    NULLIF(m.meta->>'file_type','')::text        AS file_type,
    NULLIF(m.meta->>'storage_bucket','')::text   AS storage_bucket,
    NULLIF(m.meta->>'storage_path','')::text     AS storage_path,
    NULLIF(m.meta->>'file_url','')::text         AS file_url,
    NULLIF(m.meta->>'file_name','')::text        AS file_name,
    NULLIF(m.meta->>'file_size','')::bigint      AS file_size,
    NULLIF(m.meta->>'mime_type','')::text        AS mime_type,
    NULLIF(m.meta->>'duration','')::numeric      AS duration,
    NULLIF(m.meta->>'thumbnail_url','')::text    AS thumbnail_url,
    (m.meta->>'automated')::boolean              AS automated,
    NULLIF(m.meta->>'source','')::text           AS source,
    NULLIF(m.meta->>'upload_status','')::text    AS upload_status,
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

COMMENT ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) IS
  'PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1: fast admin read of last N telegram_messages for a dialog. Bypasses Edge cold-start and skips heavy meta jsonb. Guarded by has_role(admin|superadmin).';

-- 2) Index for billing events read in ContactTelegramChat
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_action_created
  ON public.audit_logs (target_user_id, action, created_at DESC)
  WHERE target_user_id IS NOT NULL;

-- 3) Index for telegram_logs events read in ContactTelegramChat
CREATE INDEX IF NOT EXISTS idx_telegram_logs_user_created
  ON public.telegram_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;