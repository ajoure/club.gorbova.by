
-- =========================================================
-- S2: Atomic mark-as-read RPCs with server-side boundary
-- =========================================================

CREATE OR REPLACE FUNCTION public.mark_dialog_read_atomic(
  p_user_id uuid,
  p_boundary timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_boundary timestamptz := COALESCE(p_boundary, now());
  v_updated integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.telegram_messages
       SET is_read = true
     WHERE user_id = p_user_id
       AND direction = 'incoming'
       AND is_read = false
       AND created_at <= v_boundary
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_updated FROM upd;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dialog_read_atomic(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dialog_read_atomic(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dialog_read_atomic(uuid, timestamptz) TO service_role;


CREATE OR REPLACE FUNCTION public.bulk_mark_dialogs_read_atomic(
  p_user_ids uuid[],
  p_boundary timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_boundary timestamptz := COALESCE(p_boundary, now());
  v_updated integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.telegram_messages
       SET is_read = true
     WHERE user_id = ANY(p_user_ids)
       AND direction = 'incoming'
       AND is_read = false
       AND created_at <= v_boundary
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_updated FROM upd;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_mark_dialogs_read_atomic(uuid[], timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_mark_dialogs_read_atomic(uuid[], timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_mark_dialogs_read_atomic(uuid[], timestamptz) TO service_role;


-- =========================================================
-- S3: get_inbox_dialogs_v1 — LATERAL rewrite
-- Контракт колонок и сигнатура не меняются.
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_inbox_dialogs_v1(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  last_message_text text,
  last_message_at timestamptz,
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
SET search_path = public
AS $$
  WITH users AS (
    SELECT DISTINCT tm.user_id
      FROM public.telegram_messages tm
     WHERE tm.user_id IS NOT NULL
  ),
  filtered AS (
    SELECT u.user_id
      FROM users u
     WHERE p_search IS NULL OR p_search = ''
        OR EXISTS (
          SELECT 1 FROM public.profiles p
           WHERE p.user_id = u.user_id
             AND (
               p.full_name        ILIKE '%' || p_search || '%'
            OR p.email            ILIKE '%' || p_search || '%'
            OR p.phone            ILIKE '%' || p_search || '%'
            OR p.telegram_username ILIKE '%' || p_search || '%'
             )
        )
  ),
  enriched AS (
    SELECT
      f.user_id,
      last.id          AS last_message_id,
      last.created_at  AS last_message_at,
      last.bot_id      AS last_bot_id,
      COALESCE(
        last.message_text,
        CASE
          WHEN last.meta->>'file_type' IS NOT NULL
            THEN '[' || COALESCE(last.meta->>'file_type', 'file') || ']'
          ELSE NULL
        END
      ) AS last_message_text,
      last.meta->>'file_type' AS last_message_type,
      COALESCE(unread.cnt, 0)         AS unread_count,
      COALESCE(pending.has_pending, false) AS has_pending_media
    FROM filtered f
    CROSS JOIN LATERAL (
      SELECT tm.id, tm.created_at, tm.bot_id, tm.message_text, tm.meta
        FROM public.telegram_messages tm
       WHERE tm.user_id = f.user_id
       ORDER BY tm.created_at DESC
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
    tb.bot_name     AS last_bot_name
  FROM enriched e
  LEFT JOIN public.telegram_bots tb ON tb.id = e.last_bot_id
  ORDER BY e.last_message_at DESC NULLS LAST
  LIMIT LEAST(COALESCE(p_limit, 50), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_inbox_dialogs_v1(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_dialogs_v1(integer, integer, text) TO service_role;
