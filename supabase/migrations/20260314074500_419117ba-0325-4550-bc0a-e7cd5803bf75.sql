
-- PHASE 8: Fix JSON path in get_club_member_summary admin detection
-- The ->> operator returns text, not jsonb, so we need -> for nested access
CREATE OR REPLACE FUNCTION public.get_club_member_summary(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
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
    'bought_not_joined_count', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'violators_count', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'removed_count', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
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
  GROUP BY tc.channel_id, tc.chat_id, tc.members_count_chat;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;
