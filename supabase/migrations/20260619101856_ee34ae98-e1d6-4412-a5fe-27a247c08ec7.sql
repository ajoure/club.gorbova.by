
-- v4: add kicked_at, is_commercial_orphan, broader access_started_at fallback chain
DROP VIEW IF EXISTS public.v_club_members_enriched CASCADE;

CREATE VIEW public.v_club_members_enriched AS
SELECT
  tcm.id,
  tcm.club_id,
  tcm.telegram_user_id,
  tcm.telegram_username,
  tcm.telegram_first_name,
  tcm.telegram_last_name,
  tcm.in_chat,
  tcm.in_channel,
  tcm.joined_chat_at,
  tcm.profile_id,
  tcm.link_status,
  tcm.access_status,
  tcm.created_at,
  tcm.updated_at,
  p.user_id AS auth_user_id,
  p.email,
  p.full_name,
  p.phone,
  p.external_id_amo,
  CASE WHEN p.user_id IS NULL THEN false
       ELSE public.has_valid_access_for_club(p.user_id, tcm.club_id)
  END AS has_active_access,
  CASE WHEN p.user_id IS NULL THEN false
       ELSE (
         EXISTS (SELECT 1 FROM public.telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)
         OR EXISTS (SELECT 1 FROM public.telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)
         OR EXISTS (SELECT 1 FROM public.telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id)
       )
  END AS has_any_access_history,
  CASE
    WHEN tc.channel_id IS NULL THEN COALESCE(tcm.in_chat, false)
    WHEN tc.chat_id IS NULL THEN COALESCE(tcm.in_channel, false)
    ELSE (COALESCE(tcm.in_chat, false) OR COALESCE(tcm.in_channel, false))
  END AS in_any,
  ((tcm.telegram_user_id IS NULL) OR (tcm.telegram_user_id < 100)) AS is_orphaned,
  -- access_started_at: fallback chain (subs → orders → entitlements → joined_chat_at)
  CASE WHEN p.user_id IS NULL THEN tcm.joined_chat_at ELSE COALESCE(
    (SELECT MIN(s.access_start_at)
       FROM public.subscriptions_v2 s
       JOIN public.product_club_mappings pcm
         ON pcm.product_id = s.product_id AND pcm.is_active = true
      WHERE s.user_id = p.user_id AND pcm.club_id = tcm.club_id),
    (SELECT MIN(o.created_at)
       FROM public.orders_v2 o
       JOIN public.product_club_mappings pcm
         ON pcm.product_id = o.product_id AND pcm.is_active = true
      WHERE o.user_id = p.user_id AND pcm.club_id = tcm.club_id AND o.status = 'paid'),
    (SELECT MIN(e.created_at)
       FROM public.entitlements e
       JOIN public.product_club_mappings pcm
         ON pcm.product_id = e.product_id AND pcm.is_active = true
      WHERE e.user_id = p.user_id AND pcm.club_id = tcm.club_id),
    tcm.joined_chat_at
  ) END AS access_started_at,
  -- access_ended_at: только для не-removed; NULL если ещё действует
  CASE
    WHEN tcm.access_status = 'removed' THEN NULL
    WHEN p.user_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM public.entitlements e
      JOIN public.product_club_mappings pcm
        ON pcm.product_id = e.product_id AND pcm.is_active = true
      WHERE e.user_id = p.user_id AND pcm.club_id = tcm.club_id AND e.expires_at > now()
    ) THEN NULL
    ELSE COALESCE(
      (SELECT MAX(e.expires_at)
         FROM public.entitlements e
         JOIN public.product_club_mappings pcm
           ON pcm.product_id = e.product_id AND pcm.is_active = true
        WHERE e.user_id = p.user_id AND pcm.club_id = tcm.club_id),
      (SELECT MAX(s.access_end_at)
         FROM public.subscriptions_v2 s
         JOIN public.product_club_mappings pcm
           ON pcm.product_id = s.product_id AND pcm.is_active = true
        WHERE s.user_id = p.user_id AND pcm.club_id = tcm.club_id)
    )
  END AS access_ended_at,
  -- kicked_at: только для removed; MAX(audit) или updated_at fallback
  CASE
    WHEN tcm.access_status = 'removed' THEN COALESCE(
      (SELECT MAX(al.created_at)
         FROM public.audit_logs al
        WHERE al.action IN ('telegram.access_expired_revoke','telegram.autokick.attempt','AUTOKICK','telegram.kick.manual')
          AND (al.meta->>'club_id') = tcm.club_id::text
          AND (
            (p.user_id IS NOT NULL AND al.target_user_id = p.user_id)
            OR (al.meta->>'tg_user_id') = tcm.telegram_user_id::text
          )),
      tcm.updated_at
    )
    ELSE NULL
  END AS kicked_at,
  -- is_commercial_orphan: ни заказов/подписок/entitlements по продуктам клуба, ни joined_chat_at
  (
    tcm.joined_chat_at IS NULL
    AND (p.user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.orders_v2 o
      JOIN public.product_club_mappings pcm ON pcm.product_id = o.product_id AND pcm.is_active = true
      WHERE o.user_id = p.user_id AND pcm.club_id = tcm.club_id AND o.status = 'paid'
    ))
    AND (p.user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.subscriptions_v2 s
      JOIN public.product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
      WHERE s.user_id = p.user_id AND pcm.club_id = tcm.club_id
    ))
    AND (p.user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.entitlements e
      JOIN public.product_club_mappings pcm ON pcm.product_id = e.product_id AND pcm.is_active = true
      WHERE e.user_id = p.user_id AND pcm.club_id = tcm.club_id
    ))
  ) AS is_commercial_orphan
FROM public.telegram_club_members tcm
LEFT JOIN public.profiles p ON p.id = tcm.profile_id
LEFT JOIN public.telegram_clubs tc ON tc.id = tcm.club_id;

GRANT SELECT ON public.v_club_members_enriched TO authenticated, service_role;

-- RPC get_club_members_enriched
DROP FUNCTION IF EXISTS public.get_club_members_enriched(uuid, text);

CREATE OR REPLACE FUNCTION public.get_club_members_enriched(p_club_id uuid, p_scope text DEFAULT 'relevant'::text)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint, telegram_username text,
  telegram_first_name text, telegram_last_name text, in_chat boolean, in_channel boolean,
  profile_id uuid, link_status text, access_status text,
  created_at timestamptz, updated_at timestamptz,
  auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean,
  access_started_at timestamptz, access_ended_at timestamptz,
  kicked_at timestamptz, is_commercial_orphan boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any AND v.access_status != 'removed') AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown,
    v.access_started_at, v.access_ended_at, v.kicked_at, v.is_commercial_orphan
  FROM public.v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all'
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
  ORDER BY v.access_status, v.email NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_club_members_enriched(uuid, text) TO authenticated, service_role;

-- RPC search_club_members_enriched
DROP FUNCTION IF EXISTS public.search_club_members_enriched(uuid, text, text);

CREATE OR REPLACE FUNCTION public.search_club_members_enriched(p_club_id uuid, p_search text, p_scope text DEFAULT 'relevant'::text)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint, telegram_username text,
  telegram_first_name text, telegram_last_name text, in_chat boolean, in_channel boolean,
  profile_id uuid, link_status text, access_status text,
  created_at timestamptz, updated_at timestamptz,
  auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean,
  access_started_at timestamptz, access_ended_at timestamptz,
  kicked_at timestamptz, is_commercial_orphan boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user_id uuid; v_pattern text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_pattern := '%' || lower(p_search) || '%';

  RETURN QUERY
  SELECT
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any AND v.access_status != 'removed') AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown,
    v.access_started_at, v.access_ended_at, v.kicked_at, v.is_commercial_orphan
  FROM public.v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all'
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
    AND (
      lower(v.telegram_username) LIKE v_pattern
      OR lower(v.telegram_first_name) LIKE v_pattern
      OR lower(v.telegram_last_name) LIKE v_pattern
      OR lower(v.email) LIKE v_pattern
      OR lower(v.full_name) LIKE v_pattern
      OR lower(v.phone) LIKE v_pattern
      OR lower(v.external_id_amo) LIKE v_pattern
      OR v.telegram_user_id::text LIKE v_pattern
    )
  ORDER BY v.access_status, v.email NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) TO authenticated, service_role;
