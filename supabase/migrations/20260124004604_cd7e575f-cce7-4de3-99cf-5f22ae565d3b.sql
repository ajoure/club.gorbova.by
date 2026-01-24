-- =====================================================
-- P1: PERFORMANCE OPTIMIZATION - get_inbox_dialogs_v1 RPC + INDEXES
-- =====================================================

-- 1) COMPOSITE INDEX for fast dialog queries (without CONCURRENTLY)
CREATE INDEX IF NOT EXISTS idx_telegram_messages_dialog_v1
ON telegram_messages (user_id, created_at DESC);

-- 2) PARTIAL INDEX for unread count optimization
CREATE INDEX IF NOT EXISTS idx_telegram_messages_unread_v1
ON telegram_messages (user_id)
WHERE direction = 'incoming' AND is_read = false;

-- 3) RPC FUNCTION: get_inbox_dialogs_v1
-- Server-side aggregation of dialogs with unread counts and last message info
-- Replaces client-side loading of ALL messages
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
  has_pending_media BOOLEAN
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
  COALESCE(ds.has_pending_media, false) as has_pending_media
FROM dialog_stats ds
JOIN last_messages lm ON lm.user_id = ds.user_id
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

-- Grant execute to authenticated users (admin check done in frontend)
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(INT, INT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_inbox_dialogs_v1 IS 
'Performance-optimized RPC for inbox dialogs. Returns aggregated dialog list with unread counts. 
Replaces client-side grouping of all messages. STOP-guards: max 200 results.';