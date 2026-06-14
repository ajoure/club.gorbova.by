-- ROLLBACK — restore previous body of public.get_inbox_dialogs_v1
-- Источник: migration 20260222213936_7a91e6f3 (Multi-bot rewrite).
-- Применять ТОЛЬКО вручную через supabase--migration после того, как
-- фронт переключён обратно на compatibility flow и V2 RPC не вызываются.

DROP FUNCTION IF EXISTS public.get_inbox_dialogs_v1(INT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.get_inbox_dialogs_v1(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_type TEXT,
  last_message_id UUID,
  unread_count BIGINT,
  has_pending_media BOOLEAN,
  last_bot_id UUID,
  last_bot_username TEXT,
  last_bot_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH dialog_stats AS (
  SELECT
    tm.user_id,
    COUNT(*) FILTER (WHERE tm.direction = 'incoming' AND tm.is_read = false) as unread_count,
    MAX(tm.created_at) as last_message_at,
    BOOL_OR((tm.meta->>'upload_status') = 'pending') as has_pending_media
  FROM telegram_messages tm
  WHERE tm.user_id IS NOT NULL
  GROUP BY tm.user_id
),
last_messages AS (
  SELECT DISTINCT ON (tm.user_id)
    tm.user_id,
    tm.id as last_message_id,
    tm.bot_id as last_bot_id,
    COALESCE(
      tm.message_text,
      CASE
        WHEN tm.meta->>'file_type' IS NOT NULL THEN '[' || COALESCE(tm.meta->>'file_type', 'file') || ']'
        ELSE NULL
      END
    ) as last_message_text,
    tm.meta->>'file_type' as last_message_type
  FROM telegram_messages tm
  WHERE tm.user_id IS NOT NULL
  ORDER BY tm.user_id, tm.created_at DESC
)
SELECT
  ds.user_id,
  lm.last_message_text,
  ds.last_message_at,
  lm.last_message_type,
  lm.last_message_id,
  ds.unread_count,
  COALESCE(ds.has_pending_media, false) as has_pending_media,
  lm.last_bot_id,
  tb.bot_username as last_bot_username,
  tb.bot_name as last_bot_name
FROM dialog_stats ds
JOIN last_messages lm ON lm.user_id = ds.user_id
LEFT JOIN telegram_bots tb ON tb.id = lm.last_bot_id
WHERE
  CASE WHEN p_search IS NOT NULL AND p_search != '' THEN
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = ds.user_id
      AND (
        p.full_name ILIKE '%' || p_search || '%' OR
        p.email ILIKE '%' || p_search || '%' OR
        p.phone ILIKE '%' || p_search || '%' OR
        p.telegram_username ILIKE '%' || p_search || '%'
      )
    )
  ELSE true
  END
ORDER BY ds.last_message_at DESC
LIMIT LEAST(p_limit, 200)
OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_inbox_dialogs_v1(INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(INT, INT, TEXT) TO service_role;
