CREATE OR REPLACE FUNCTION public.get_inbox_dialogs_v1(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL::text
)
RETURNS TABLE(
  user_id uuid,
  last_message_text text,
  last_message_at timestamp with time zone,
  last_message_type text,
  last_message_id uuid,
  unread_count bigint,
  has_pending_media boolean,
  last_bot_id uuid,
  last_bot_username text,
  last_bot_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH search_input AS (
    SELECT
      NULLIF(btrim(COALESCE(p_search, '')), '') AS q,
      lower(NULLIF(btrim(COALESCE(p_search, '')), '')) AS q_lower,
      lower(
        regexp_replace(
          regexp_replace(
            NULLIF(btrim(COALESCE(p_search, '')), ''),
            '^(https?://)?(t\.me/|telegram\.me/|@)+',
            '',
            'i'
          ),
          '^@+',
          ''
        )
      ) AS q_username,
      regexp_replace(COALESCE(p_search, ''), '\s+', '', 'g') AS q_digits
  ),
  users AS (
    SELECT DISTINCT tm.user_id
      FROM public.telegram_messages tm
     WHERE tm.user_id IS NOT NULL
  ),
  filtered AS (
    SELECT u.user_id
      FROM users u
      CROSS JOIN search_input si
     WHERE si.q IS NULL
        OR EXISTS (
          SELECT 1
            FROM public.profiles p
           WHERE (p.user_id = u.user_id OR p.id = u.user_id)
             AND (
               p.full_name ILIKE '%' || si.q || '%'
            OR p.email ILIKE '%' || si.q || '%'
            OR p.phone ILIKE '%' || si.q || '%'
            OR p.telegram_username ILIKE '%' || si.q || '%'
            OR (
                 si.q_username IS NOT NULL
             AND si.q_username <> ''
             AND regexp_replace(lower(COALESCE(p.telegram_username, '')), '^@+', '') ILIKE '%' || si.q_username || '%'
               )
            OR (
                 si.q_digits ~ '^\d+$'
             AND p.telegram_user_id IS NOT NULL
             AND p.telegram_user_id::text = si.q_digits
               )
             )
        )
  ),
  enriched AS (
    SELECT
      f.user_id,
      last.id AS last_message_id,
      last.created_at AS last_message_at,
      last.bot_id AS last_bot_id,
      COALESCE(
        last.message_text,
        CASE
          WHEN last.meta->>'file_type' IS NOT NULL
            THEN '[' || COALESCE(last.meta->>'file_type', 'file') || ']'
          ELSE NULL
        END
      ) AS last_message_text,
      last.meta->>'file_type' AS last_message_type,
      COALESCE(unread.cnt, 0) AS unread_count,
      COALESCE(pending.has_pending, false) AS has_pending_media
    FROM filtered f
    CROSS JOIN LATERAL (
      SELECT tm.id, tm.created_at, tm.bot_id, tm.message_text, tm.meta
        FROM public.telegram_messages tm
       WHERE tm.user_id = f.user_id
       ORDER BY tm.created_at DESC, tm.id DESC
       LIMIT 1
    ) last
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::bigint AS cnt
        FROM public.telegram_messages tm
       WHERE tm.user_id = f.user_id
         AND tm.direction = 'incoming'
         AND tm.is_read = false
    ) unread ON true
    LEFT JOIN LATERAL (
      SELECT true AS has_pending
        FROM public.telegram_messages tm
       WHERE tm.user_id = f.user_id
         AND (tm.meta->>'upload_status') = 'pending'
       LIMIT 1
    ) pending ON true
  )
  SELECT
    e.user_id,
    e.last_message_text,
    e.last_message_at,
    e.last_message_type,
    e.last_message_id,
    e.unread_count,
    e.has_pending_media,
    e.last_bot_id,
    tb.bot_username AS last_bot_username,
    tb.bot_name AS last_bot_name
  FROM enriched e
  LEFT JOIN public.telegram_bots tb ON tb.id = e.last_bot_id
  ORDER BY e.last_message_at DESC NULLS LAST, e.last_message_id DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(integer, integer, text) TO service_role;