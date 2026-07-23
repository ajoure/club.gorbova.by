-- Contact-center access is granted through RBAC v3 section permissions.
-- The chat read RPCs predated that model and still accepted only legacy
-- admin/superadmin roles. Because they are SECURITY DEFINER functions, their
-- own predicate is authoritative and RLS cannot broaden the result.

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
    ap.full_name AS admin_full_name,
    ap.avatar_url AS admin_avatar_url
  FROM public.telegram_messages m
  LEFT JOIN public.telegram_bots b ON b.id = m.bot_id
  LEFT JOIN public.profiles ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id
    AND public.has_admin_section_access(
      (SELECT auth.uid()),
      'communication',
      'view'
    )
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) TO service_role;

COMMENT ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) IS
  'Contact-center Telegram history read path. Requires communication:view through RBAC v3.';

CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_page_v2(
  p_user_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_admin_section_access(
    (SELECT auth.uid()),
    'communication',
    'view'
  ) THEN
    RAISE EXCEPTION 'access denied: communication:view required'
      USING ERRCODE = '42501';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'both cursor fields must be provided together'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
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
    ap.full_name AS admin_full_name,
    ap.avatar_url AS admin_avatar_url
  FROM public.telegram_messages m
  LEFT JOIN public.telegram_bots b ON b.id = m.bot_id
  LEFT JOIN public.profiles ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id
    AND (
      p_before_created_at IS NULL
      OR (m.created_at, m.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_page_v2(uuid, timestamptz, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_page_v2(uuid, timestamptz, uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_page_v2(uuid, timestamptz, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_page_v2(uuid, timestamptz, uuid, int) TO service_role;

COMMENT ON FUNCTION public.admin_get_telegram_messages_page_v2(uuid, timestamptz, uuid, int) IS
  'Cursor-paginated Telegram history for the contact center. Requires communication:view.';

CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_lean_v1(
  p_user_id uuid,
  p_limit int DEFAULT 20,
  p_text_limit int DEFAULT 4096
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  telegram_user_id bigint,
  bot_id uuid,
  message_id bigint,
  direction text,
  message_text text,
  is_truncated boolean,
  reply_to_message_id bigint,
  sent_by_admin uuid,
  is_read boolean,
  is_pinned boolean,
  is_favorite boolean,
  status text,
  error_message text,
  created_at timestamptz,
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
  bot_name text,
  bot_username text,
  admin_full_name text,
  admin_avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_admin_section_access(
    (SELECT auth.uid()),
    'communication',
    'view'
  ) THEN
    RAISE EXCEPTION 'access denied: communication:view required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.user_id,
    m.telegram_user_id,
    m.bot_id,
    m.message_id,
    m.direction,
    CASE
      WHEN m.message_text IS NULL THEN NULL
      WHEN length(m.message_text) > p_text_limit THEN left(m.message_text, p_text_limit)
      ELSE m.message_text
    END AS message_text,
    (m.message_text IS NOT NULL AND length(m.message_text) > p_text_limit) AS is_truncated,
    m.reply_to_message_id,
    m.sent_by_admin,
    m.is_read,
    m.is_pinned,
    m.is_favorite,
    m.status,
    m.error_message,
    m.created_at,
    NULLIF(m.meta->>'file_type', '')::text AS file_type,
    NULLIF(m.meta->>'storage_bucket', '')::text AS storage_bucket,
    NULLIF(m.meta->>'storage_path', '')::text AS storage_path,
    NULLIF(m.meta->>'file_url', '')::text AS file_url,
    NULLIF(m.meta->>'file_name', '')::text AS file_name,
    NULLIF(m.meta->>'file_size', '')::bigint AS file_size,
    NULLIF(m.meta->>'mime_type', '')::text AS mime_type,
    NULLIF(m.meta->>'duration', '')::numeric AS duration,
    NULLIF(m.meta->>'thumbnail_url', '')::text AS thumbnail_url,
    (m.meta->>'automated')::boolean AS automated,
    NULLIF(m.meta->>'source', '')::text AS source,
    NULLIF(m.meta->>'upload_status', '')::text AS upload_status,
    b.bot_name,
    b.bot_username,
    ap.full_name AS admin_full_name,
    ap.avatar_url AS admin_avatar_url
  FROM public.telegram_messages m
  LEFT JOIN public.telegram_bots b ON b.id = m.bot_id
  LEFT JOIN public.profiles ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_lean_v1(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_telegram_messages_lean_v1(uuid, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_lean_v1(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_lean_v1(uuid, int, int) TO service_role;

COMMENT ON FUNCTION public.admin_get_telegram_messages_lean_v1(uuid, int, int) IS
  'Lean contact-center Telegram history read path. Requires communication:view through RBAC v3.';
