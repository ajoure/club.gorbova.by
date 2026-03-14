
-- PATCH-STAT-2: Drop search function first (parameter name conflict)
DROP FUNCTION IF EXISTS public.search_club_members_enriched(uuid, text, text);

-- Fix 2: search_club_members_enriched — same is_bought_not_joined fix
CREATE OR REPLACE FUNCTION public.search_club_members_enriched(
  p_club_id uuid,
  p_search text,
  p_scope text DEFAULT 'relevant'::text
)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint,
  telegram_username text, telegram_first_name text, telegram_last_name text,
  in_chat boolean, in_channel boolean, profile_id uuid, link_status text,
  access_status text, created_at timestamp with time zone, updated_at timestamp with time zone,
  auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_pattern text;
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
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown
  FROM v_club_members_enriched v
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

GRANT EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) TO authenticated;

-- Fix 3: get_club_member_summary — unified criteria
CREATE OR REPLACE FUNCTION public.get_club_member_summary(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result jsonb;
  v_bot_admin_count int := 0;
  v_bot_tg_id bigint;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Count bot admins not in members table
  SELECT tb.bot_id INTO v_bot_tg_id
  FROM telegram_clubs tc
  JOIN telegram_bots tb ON tb.id = tc.bot_id
  WHERE tc.id = p_club_id;

  IF v_bot_tg_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM telegram_club_members tcm
      WHERE tcm.club_id = p_club_id AND tcm.telegram_user_id = v_bot_tg_id
    ) THEN
      v_bot_admin_count := 1;
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'resource_mode', 
    CASE
      WHEN tc.channel_id IS NULL AND tc.chat_id IS NOT NULL THEN 'chat_only'
      WHEN tc.chat_id IS NULL AND tc.channel_id IS NOT NULL THEN 'channel_only'
      ELSE 'chat_and_channel'
    END,
    'in_club_total', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'in_club_admins', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin),
    'in_club_regular', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'with_access_total', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false)),
    'with_access_admins', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin),
    'with_access_regular', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    -- PATCH-STAT-2: exclude removed from bought_not_joined
    'bought_not_joined_count', COUNT(*) FILTER (
      WHERE COALESCE(v.has_active_access, false) 
        AND NOT v.in_any 
        AND NOT COALESCE(v.is_orphaned, false)
        AND v.access_status != 'removed'
    ),
    'violators_count', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'removed_count', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    -- PATCH-STAT-2: admins_total = member admins (all, not just in_any) + bot admins not in members
    'admins_total', COUNT(*) FILTER (WHERE ac.is_admin AND NOT COALESCE(v.is_orphaned, false)) + v_bot_admin_count,
    'outside_system_count', 
      CASE 
        WHEN tc.chat_id IS NOT NULL THEN 
          GREATEST(0, COALESCE(tc.members_count_chat, 0) - COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND NOT COALESCE(v.is_orphaned, false)))
        ELSE NULL
      END,
    'total_synced', COUNT(*) FILTER (WHERE NOT COALESCE(v.is_orphaned, false)),
    'orphaned', COUNT(*) FILTER (WHERE COALESCE(v.is_orphaned, false))
  ) INTO v_result
  FROM v_club_members_enriched v
  JOIN telegram_clubs tc ON tc.id = v.club_id
  LEFT JOIN telegram_club_members tcm2 ON tcm2.id = v.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      tcm2.last_telegram_check_result->'chat'->>'status' IN ('administrator', 'creator')
      OR tcm2.last_telegram_check_result->'channel'->>'status' IN ('administrator', 'creator'),
      false
    ) AS is_admin
  ) ac
  WHERE v.club_id = p_club_id
    AND NOT COALESCE(v.is_orphaned, false)
    AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
  GROUP BY tc.channel_id, tc.chat_id, tc.members_count_chat;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;
