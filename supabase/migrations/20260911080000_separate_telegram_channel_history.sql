-- Read-model only. Never relabel, copy, delete or reassign historical messages.
CREATE OR REPLACE FUNCTION public.admin_get_contact_telegram_channels_v1(p_user_id uuid)
RETURNS TABLE (
  channel_key text, transport text, channel_ref uuid, label text, username text,
  bot_id uuid, first_name text, last_name text, business_connection_id text,
  is_primary boolean, can_reply boolean, message_count bigint,
  incoming_count bigint, unanswered_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH channels AS (
    SELECT 'bot'::text AS transport, b.id AS channel_ref,
           COALESCE(NULLIF(b.bot_name, ''), '@' || b.bot_username)::text AS label,
           b.bot_username::text AS username, b.id AS bot_id,
           NULL::text AS first_name, NULL::text AS last_name,
           NULL::text AS business_connection_id,
           COALESCE(b.is_primary, false) AS is_primary, true AS can_reply
    FROM public.telegram_bots b WHERE b.status = 'active'
    UNION ALL
    SELECT 'business', c.id,
           COALESCE(NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
                    '@' || c.username, 'Личный аккаунт') || ' · личный Telegram',
           c.username, c.bot_id, c.first_name, c.last_name, c.connection_id,
           false, c.is_enabled AND c.can_reply AND EXISTS (
             SELECT 1 FROM public.telegram_messages m
             WHERE m.user_id = p_user_id AND m.transport = 'business'
               AND m.business_account_id = c.id
           )
    FROM public.telegram_business_connections c
    WHERE c.is_enabled OR EXISTS (
      SELECT 1 FROM public.telegram_messages m
      WHERE m.user_id = p_user_id AND m.transport = 'business' AND m.business_account_id = c.id
    )
  ), counts AS (
    SELECT m.transport, CASE WHEN m.transport = 'business' THEN m.business_account_id ELSE m.bot_id END AS channel_ref,
           count(*) AS message_count,
           count(*) FILTER (WHERE m.direction = 'incoming') AS incoming_count,
           count(*) FILTER (WHERE m.direction = 'incoming' AND (m.requires_reply OR NOT m.is_read)) AS unanswered_count
    FROM public.telegram_messages m WHERE m.user_id = p_user_id
    GROUP BY m.transport, CASE WHEN m.transport = 'business' THEN m.business_account_id ELSE m.bot_id END
  )
  SELECT c.transport || ':' || c.channel_ref, c.transport, c.channel_ref, c.label, c.username,
         c.bot_id, c.first_name, c.last_name, c.business_connection_id,
         c.is_primary, c.can_reply, COALESCE(n.message_count, 0),
         COALESCE(n.incoming_count, 0), COALESCE(n.unanswered_count, 0)
  FROM channels c LEFT JOIN counts n USING (transport, channel_ref)
  WHERE public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view')
  ORDER BY c.is_primary DESC, c.transport, c.label, c.channel_ref;
$$;
REVOKE ALL ON FUNCTION public.admin_get_contact_telegram_channels_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_contact_telegram_channels_v1(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_telegram_channel_messages_v1(
  p_user_id uuid, p_transport text, p_channel_ref uuid,
  p_limit integer DEFAULT 100,
  p_before_created_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL,
  p_text_limit integer DEFAULT NULL, p_unanswered_only boolean DEFAULT false
)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'), false) THEN
    RAISE EXCEPTION 'access denied: communication:view required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_channel_ref IS NULL OR p_transport IS NULL OR p_transport NOT IN ('bot', 'business') THEN
    RAISE EXCEPTION 'explicit Telegram channel required' USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'both cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT to_jsonb(m) || jsonb_build_object(
    'message_text', CASE WHEN p_text_limit IS NULL THEN m.message_text ELSE left(m.message_text, LEAST(GREATEST(p_text_limit, 1), 4096)) END,
    'is_truncated', p_text_limit IS NOT NULL AND length(m.message_text) > LEAST(GREATEST(p_text_limit, 1), 4096),
    'meta', CASE WHEN p_text_limit IS NULL THEN m.meta ELSE m.meta - 'raw' - 'reply_markup' END,
    'bot_name', b.bot_name, 'bot_username', b.bot_username,
    'admin_full_name', ap.full_name, 'admin_avatar_url', ap.avatar_url
  )
  FROM public.telegram_messages m
  LEFT JOIN public.telegram_bots b ON b.id = m.bot_id
  LEFT JOIN public.profiles ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id AND m.transport = p_transport
    AND ((p_transport = 'bot' AND m.bot_id = p_channel_ref)
      OR (p_transport = 'business' AND m.business_account_id = p_channel_ref))
    AND (NOT p_unanswered_only OR (m.direction = 'incoming' AND (m.requires_reply OR NOT m.is_read)))
    AND (p_before_created_at IS NULL OR (m.created_at, m.id) < (p_before_created_at, p_before_id))
  ORDER BY CASE WHEN p_unanswered_only THEN m.created_at END ASC,
           CASE WHEN p_unanswered_only THEN m.id END ASC,
           m.created_at DESC, m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_telegram_channel_messages_v1(uuid, text, uuid, integer, timestamptz, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_telegram_channel_messages_v1(uuid, text, uuid, integer, timestamptz, uuid, integer, boolean) TO authenticated, service_role;
