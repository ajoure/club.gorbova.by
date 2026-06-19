
CREATE OR REPLACE FUNCTION public.get_club_members_enriched(p_club_id uuid, p_scope text DEFAULT 'relevant'::text)
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
#variable_conflict use_column
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
    SELECT tcm.id AS mid, tcm.club_id AS mclub, tcm.telegram_user_id AS mtuid, tcm.telegram_username AS mtuname,
      tcm.telegram_first_name AS mtfn, tcm.telegram_last_name AS mtln, tcm.in_chat AS min_chat, tcm.in_channel AS min_channel,
      tcm.profile_id AS mpid, tcm.link_status AS mlink, tcm.access_status AS macc,
      tcm.created_at AS mcreated, tcm.updated_at AS mupdated, tcm.joined_chat_at AS mjoined,
      p.user_id AS uid, p.email AS pemail, p.full_name AS pname, p.phone AS pphone, p.external_id_amo AS pamo
    FROM telegram_club_members tcm
    LEFT JOIN profiles p ON p.id = tcm.profile_id
    WHERE tcm.club_id = p_club_id
  ),
  ent_agg AS (
    SELECT e.user_id AS uid,
      max(e.expires_at) AS ent_max, min(e.created_at) AS ent_min,
      bool_or(e.expires_at > now()) AS ent_active, true AS has_ent
    FROM entitlements e
    WHERE e.product_id IN (SELECT product_id FROM club_products)
      AND e.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY e.user_id
  ),
  sub_agg AS (
    SELECT s.user_id AS uid,
      max(s.access_end_at) AS sub_max, min(s.access_start_at) AS sub_min,
      bool_or(s.status IN ('active'::subscription_status,'trial'::subscription_status) AND s.access_end_at IS NOT NULL AND s.access_end_at > now()) AS sub_active,
      true AS has_sub
    FROM subscriptions_v2 s
    WHERE s.product_id IN (SELECT product_id FROM club_products)
      AND s.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY s.user_id
  ),
  ord_agg AS (
    SELECT o.user_id AS uid,
      max(o.created_at) AS order_max_paid, min(o.created_at) AS order_min_paid, true AS has_order
    FROM orders_v2 o
    WHERE o.product_id IN (SELECT product_id FROM club_products) AND o.status='paid'::order_status
      AND o.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY o.user_id
  ),
  ta_agg AS (
    SELECT ta.user_id AS uid, true AS has_ta FROM telegram_access ta
    WHERE ta.club_id = p_club_id AND ta.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY ta.user_id
  ),
  tma_agg AS (
    SELECT tma.user_id AS uid, true AS has_tma FROM telegram_manual_access tma
    WHERE tma.club_id = p_club_id AND tma.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY tma.user_id
  ),
  tag_agg AS (
    SELECT tag.user_id AS uid, true AS has_tag FROM telegram_access_grants tag
    WHERE tag.club_id = p_club_id AND tag.user_id IN (SELECT uid FROM m WHERE uid IS NOT NULL)
    GROUP BY tag.user_id
  ),
  kick_agg AS (
    SELECT m.mid AS mid, max(al.created_at) AS kicked_at
    FROM m JOIN audit_logs al ON
      al.action = ANY (ARRAY['telegram.access_expired_revoke','telegram.autokick.attempt','AUTOKICK','telegram.kick.manual'])
      AND (al.meta->>'club_id') = p_club_id::text
      AND COALESCE((al.meta->>'dry_run')::boolean, false) = false
      AND (COALESCE(al.meta->>'result','success') <> ALL (ARRAY['failed','error','skipped','blocked']))
      AND (
        (m.uid IS NOT NULL AND al.target_user_id = m.uid)
        OR (m.mtuid IS NOT NULL AND (al.meta->>'tg_user_id') = m.mtuid::text)
        OR (m.mtuid IS NOT NULL AND (al.meta->>'telegram_user_id') = m.mtuid::text)
        OR (m.mpid IS NOT NULL AND (al.meta->>'profile_id') = m.mpid::text)
      )
    WHERE m.macc = 'removed'
    GROUP BY m.mid
  ),
  enriched AS (
    SELECT
      m.mid, m.mclub, m.mtuid, m.mtuname, m.mtfn, m.mtln,
      m.min_chat, m.min_channel, m.mpid, m.mlink, m.macc, m.mcreated, m.mupdated,
      m.uid, m.pemail, m.pname, m.pphone, m.pamo,
      CASE WHEN m.uid IS NULL THEN false ELSE has_valid_access_for_club(m.uid, p_club_id) END AS x_has_active_access,
      (COALESCE(ta.has_ta, false) OR COALESCE(tma.has_tma, false) OR COALESCE(tg.has_tag, false)) AS x_has_any_access_history,
      CASE
        WHEN NOT v_has_channel THEN COALESCE(m.min_chat, false)
        WHEN NOT v_has_chat THEN COALESCE(m.min_channel, false)
        ELSE COALESCE(m.min_chat, false) OR COALESCE(m.min_channel, false)
      END AS x_in_any,
      (m.mtuid IS NULL OR m.mtuid < 100) AS x_is_orphaned,
      COALESCE(sa.sub_min, oa.order_min_paid, ea.ent_min, m.mjoined) AS x_access_started_at,
      CASE
        WHEN m.macc = 'removed' THEN NULL::timestamptz
        WHEN COALESCE(ea.ent_active, false) THEN NULL::timestamptz
        ELSE COALESCE(ea.ent_max, sa.sub_max)
      END AS x_access_ended_at,
      COALESCE(ea.ent_max, sa.sub_max, oa.order_max_paid + interval '30 days') AS x_commercial_ended_at,
      ka.kicked_at AS x_kicked_at,
      CASE WHEN m.macc = 'removed' AND ka.kicked_at IS NOT NULL THEN 'audit_log'
           WHEN m.macc = 'removed' THEN 'unknown'
           ELSE NULL END AS x_kicked_at_source,
      (COALESCE(oa.has_order, false) OR COALESCE(sa.has_sub, false) OR COALESCE(ea.has_ent, false)) AS x_has_commercial_history,
      (COALESCE(ea.ent_active, false) OR COALESCE(sa.sub_active, false)) AS x_has_current_commercial_access
    FROM m
    LEFT JOIN ent_agg ea ON ea.uid = m.uid
    LEFT JOIN sub_agg sa ON sa.uid = m.uid
    LEFT JOIN ord_agg oa ON oa.uid = m.uid
    LEFT JOIN ta_agg ta ON ta.uid = m.uid
    LEFT JOIN tma_agg tma ON tma.uid = m.uid
    LEFT JOIN tag_agg tg ON tg.uid = m.uid
    LEFT JOIN kick_agg ka ON ka.mid = m.mid
  )
  SELECT
    e.mid, e.mclub, e.mtuid, e.mtuname, e.mtfn, e.mtln,
    e.min_chat, e.min_channel, e.mpid, e.mlink, e.macc, e.mcreated, e.mupdated,
    e.uid, e.pemail, e.pname, e.pphone, e.pamo,
    e.x_has_active_access, e.x_has_any_access_history, e.x_in_any, e.x_is_orphaned,
    (e.x_in_any AND NOT COALESCE(e.x_has_active_access, false)),
    (COALESCE(e.x_has_active_access, false) AND NOT e.x_in_any AND e.macc <> 'removed'),
    (e.x_in_any OR e.macc = 'removed' OR COALESCE(e.x_has_any_access_history, false)),
    NOT (e.x_in_any OR COALESCE(e.x_has_active_access, false) OR e.macc = 'removed'),
    e.x_access_started_at, e.x_access_ended_at, e.x_commercial_ended_at, e.x_kicked_at, e.x_kicked_at_source,
    NOT e.x_has_commercial_history,
    e.x_has_commercial_history, e.x_has_current_commercial_access,
    CASE
      WHEN e.x_commercial_ended_at IS NULL THEN NULL
      WHEN e.x_kicked_at IS NOT NULL AND e.x_kicked_at > e.x_commercial_ended_at
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (e.x_kicked_at - e.x_commercial_ended_at))/86400)::integer)
      WHEN e.macc <> 'removed' AND (COALESCE(e.min_chat,false) OR COALESCE(e.min_channel,false)) AND e.x_commercial_ended_at < now()
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - e.x_commercial_ended_at))/86400)::integer)
      ELSE 0
    END
  FROM enriched e
  WHERE p_scope = 'all'
    OR (p_scope = 'relevant' AND NOT COALESCE(e.x_is_orphaned, false)
        AND (e.x_in_any OR e.macc = 'removed' OR COALESCE(e.x_has_any_access_history, false)))
  ORDER BY e.macc, e.pemail NULLS LAST;
END; $$;
