-- PATCH-STAT-3: Sync get_club_members_enriched with search_club_members_enriched and get_club_member_summary
-- Fix: add AND v.access_status != 'removed' to is_bought_not_joined
CREATE OR REPLACE FUNCTION public.get_club_members_enriched(
  p_club_id uuid, 
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
    -- PATCH-STAT-3: added AND v.access_status != 'removed' to match summary and search RPCs
    (COALESCE(v.has_active_access, false) AND NOT v.in_any AND v.access_status != 'removed') AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (
      v.in_any OR 
      COALESCE(v.has_active_access, false) OR 
      v.access_status = 'removed'
    ) AS is_unknown
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all' 
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND 
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
  ORDER BY v.access_status, v.email NULLS LAST;
END;
$function$;