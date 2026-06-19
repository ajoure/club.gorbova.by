
DROP FUNCTION IF EXISTS public.get_club_members_enriched(uuid, text);
DROP FUNCTION IF EXISTS public.search_club_members_enriched(uuid, text, text);

CREATE FUNCTION public.get_club_members_enriched(p_club_id uuid, p_scope text DEFAULT 'relevant'::text)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint, telegram_username text, telegram_first_name text, telegram_last_name text,
  in_chat boolean, in_channel boolean, profile_id uuid, link_status text, access_status text,
  created_at timestamptz, updated_at timestamptz, auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean,
  access_started_at timestamptz, access_ended_at timestamptz, commercial_ended_at timestamptz,
  kicked_at timestamptz, kicked_at_source text, is_commercial_orphan boolean,
  has_commercial_history boolean, has_current_commercial_access boolean, illegal_access_days integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user_id uuid; v_has_chat boolean; v_has_channel boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (NOT public.has_role(v_user_id,'admin'::app_role) AND NOT public.has_role(v_user_id,'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;

  SELECT (tc.chat_id IS NOT NULL), (tc.channel_id IS NOT NULL) INTO v_has_chat, v_has_channel
  FROM telegram_clubs tc WHERE tc.id = p_club_id;

  RETURN QUERY
  WITH club_products AS (
    SELECT pcm.product_id FROM product_club_mappings pcm WHERE pcm.club_id = p_club_id AND pcm.is_active = true
  ),
  m AS (
    SELECT tcm.*, p.user_id AS auth_user_id, p.email, p.full_name, p.phone, p.external_id_amo
    FROM telegram_club_members tcm
    LEFT JOIN profiles p ON p.id = tcm.profile_id
    WHERE tcm.club_id = p_club_id
  ),
  ent_agg AS (
    SELECT e.user_id,
      max(e.expires_at) AS ent_max,
      min(e.created_at) AS ent_min,
      bool_or(e.expires_at > now()) AS ent_active,
      true AS has_ent
    FROM entitlements e
    WHERE e.product_id IN (SELECT product_id FROM club_products)
      AND e.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY e.user_id
  ),
  sub_agg AS (
    SELECT s.user_id,
      max(s.access_end_at) AS sub_max,
      min(s.access_start_at) AS sub_min,
      bool_or(s.status IN ('active'::subscription_status,'trial'::subscription_status) AND s.access_end_at IS NOT NULL AND s.access_end_at > now()) AS sub_active,
      true AS has_sub
    FROM subscriptions_v2 s
    WHERE s.product_id IN (SELECT product_id FROM club_products)
      AND s.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY s.user_id
  ),
  ord_agg AS (
    SELECT o.user_id,
      max(o.created_at) AS order_max_paid,
      min(o.created_at) AS order_min_paid,
      true AS has_order
    FROM orders_v2 o
    WHERE o.product_id IN (SELECT product_id FROM club_products)
      AND o.status = 'paid'::order_status
      AND o.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY o.user_id
  ),
  ta_agg AS (
    SELECT ta.user_id, true AS has_ta FROM telegram_access ta
    WHERE ta.club_id = p_club_id AND ta.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY ta.user_id
  ),
  tma_agg AS (
    SELECT tma.user_id, true AS has_tma FROM telegram_manual_access tma
    WHERE tma.club_id = p_club_id AND tma.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY tma.user_id
  ),
  tag_agg AS (
    SELECT tag.user_id, true AS has_tag FROM telegram_access_grants tag
    WHERE tag.club_id = p_club_id AND tag.user_id IN (SELECT auth_user_id FROM m WHERE auth_user_id IS NOT NULL)
    GROUP BY tag.user_id
  ),
  kick_agg AS (
    SELECT m.id AS mid, max(al.created_at) AS kicked_at
    FROM m
    JOIN audit_logs al ON
      al.action = ANY (ARRAY['telegram.access_expired_revoke','telegram.autokick.attempt','AUTOKICK','telegram.kick.manual'])
      AND (al.meta->>'club_id') = p_club_id::text
      AND COALESCE((al.meta->>'dry_run')::boolean, false) = false
      AND (COALESCE(al.meta->>'result','success') <> ALL (ARRAY['failed','error','skipped','blocked']))
      AND (
        (m.auth_user_id IS NOT NULL AND al.target_user_id = m.auth_user_id)
        OR (m.telegram_user_id IS NOT NULL AND (al.meta->>'tg_user_id') = m.telegram_user_id::text)
        OR (m.telegram_user_id IS NOT NULL AND (al.meta->>'telegram_user_id') = m.telegram_user_id::text)
        OR (m.profile_id IS NOT NULL AND (al.meta->>'profile_id') = m.profile_id::text)
      )
    WHERE m.access_status = 'removed'
    GROUP BY m.id
  ),
  enriched AS (
    SELECT
      m.id, m.club_id, m.telegram_user_id, m.telegram_username, m.telegram_first_name, m.telegram_last_name,
      m.in_chat, m.in_channel, m.profile_id, m.link_status, m.access_status, m.created_at, m.updated_at,
      m.auth_user_id, m.email, m.full_name, m.phone, m.external_id_amo,
      CASE WHEN m.auth_user_id IS NULL THEN false ELSE has_valid_access_for_club(m.auth_user_id, p_club_id) END AS has_active_access,
      COALESCE(ta.has_ta, false) OR COALESCE(tma.has_tma, false) OR COALESCE(tg.has_tag, false) AS has_any_access_history,
      CASE
        WHEN NOT v_has_channel THEN COALESCE(m.in_chat, false)
        WHEN NOT v_has_chat THEN COALESCE(m.in_channel, false)
        ELSE COALESCE(m.in_chat, false) OR COALESCE(m.in_channel, false)
      END AS in_any,
      (m.telegram_user_id IS NULL OR m.telegram_user_id < 100) AS is_orphaned,
      COALESCE(sa.sub_min, oa.order_min_paid, ea.ent_min, m.joined_chat_at) AS access_started_at,
      CASE
        WHEN m.access_status = 'removed' THEN NULL::timestamptz
        WHEN COALESCE(ea.ent_active, false) THEN NULL::timestamptz
        ELSE COALESCE(ea.ent_max, sa.sub_max)
      END AS access_ended_at,
      COALESCE(ea.ent_max, sa.sub_max, oa.order_max_paid + interval '30 days') AS commercial_ended_at,
      ka.kicked_at AS kicked_at,
      CASE WHEN m.access_status = 'removed' AND ka.kicked_at IS NOT NULL THEN 'audit_log'
           WHEN m.access_status = 'removed' THEN 'unknown'
           ELSE NULL END AS kicked_at_source,
      (COALESCE(oa.has_order, false) OR COALESCE(sa.has_sub, false) OR COALESCE(ea.has_ent, false)) AS has_commercial_history,
      (COALESCE(ea.ent_active, false) OR COALESCE(sa.sub_active, false)) AS has_current_commercial_access
    FROM m
    LEFT JOIN ent_agg ea ON ea.user_id = m.auth_user_id
    LEFT JOIN sub_agg sa ON sa.user_id = m.auth_user_id
    LEFT JOIN ord_agg oa ON oa.user_id = m.auth_user_id
    LEFT JOIN ta_agg ta ON ta.user_id = m.auth_user_id
    LEFT JOIN tma_agg tma ON tma.user_id = m.auth_user_id
    LEFT JOIN tag_agg tg ON tg.user_id = m.auth_user_id
    LEFT JOIN kick_agg ka ON ka.mid = m.id
  )
  SELECT
    e.id, e.club_id, e.telegram_user_id, e.telegram_username, e.telegram_first_name, e.telegram_last_name,
    e.in_chat, e.in_channel, e.profile_id, e.link_status, e.access_status, e.created_at, e.updated_at,
    e.auth_user_id, e.email, e.full_name, e.phone, e.external_id_amo,
    e.has_active_access, e.has_any_access_history, e.in_any, e.is_orphaned,
    (e.in_any AND NOT COALESCE(e.has_active_access, false)),
    (COALESCE(e.has_active_access, false) AND NOT e.in_any AND e.access_status <> 'removed'),
    (e.in_any OR e.access_status = 'removed' OR COALESCE(e.has_any_access_history, false)),
    NOT (e.in_any OR COALESCE(e.has_active_access, false) OR e.access_status = 'removed'),
    e.access_started_at, e.access_ended_at, e.commercial_ended_at, e.kicked_at, e.kicked_at_source,
    NOT e.has_commercial_history AS is_commercial_orphan,
    e.has_commercial_history, e.has_current_commercial_access,
    CASE
      WHEN e.commercial_ended_at IS NULL THEN NULL
      WHEN e.kicked_at IS NOT NULL AND e.kicked_at > e.commercial_ended_at
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (e.kicked_at - e.commercial_ended_at))/86400)::integer)
      WHEN e.access_status <> 'removed' AND (COALESCE(e.in_chat,false) OR COALESCE(e.in_channel,false)) AND e.commercial_ended_at < now()
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - e.commercial_ended_at))/86400)::integer)
      ELSE 0
    END AS illegal_access_days
  FROM enriched e
  WHERE p_scope = 'all'
    OR (p_scope = 'relevant' AND NOT COALESCE(e.is_orphaned, false)
        AND (e.in_any OR e.access_status = 'removed' OR COALESCE(e.has_any_access_history, false)))
  ORDER BY e.access_status, e.email NULLS LAST;
END; $$;

CREATE FUNCTION public.search_club_members_enriched(p_club_id uuid, p_search text, p_scope text DEFAULT 'relevant'::text)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint, telegram_username text, telegram_first_name text, telegram_last_name text,
  in_chat boolean, in_channel boolean, profile_id uuid, link_status text, access_status text,
  created_at timestamptz, updated_at timestamptz, auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean,
  access_started_at timestamptz, access_ended_at timestamptz, commercial_ended_at timestamptz,
  kicked_at timestamptz, kicked_at_source text, is_commercial_orphan boolean,
  has_commercial_history boolean, has_current_commercial_access boolean, illegal_access_days integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user_id uuid; v_q text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (NOT public.has_role(v_user_id,'admin'::app_role) AND NOT public.has_role(v_user_id,'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  v_q := '%' || lower(coalesce(p_search,'')) || '%';
  RETURN QUERY
  SELECT * FROM public.get_club_members_enriched(p_club_id, p_scope) r
  WHERE coalesce(p_search,'') = ''
    OR lower(coalesce(r.telegram_username,'')) LIKE v_q
    OR lower(coalesce(r.telegram_first_name,'')) LIKE v_q
    OR lower(coalesce(r.telegram_last_name,'')) LIKE v_q
    OR lower(coalesce(r.email,'')) LIKE v_q
    OR lower(coalesce(r.full_name,'')) LIKE v_q
    OR lower(coalesce(r.phone,'')) LIKE v_q
    OR coalesce(r.telegram_user_id::text,'') LIKE v_q;
END; $$;
