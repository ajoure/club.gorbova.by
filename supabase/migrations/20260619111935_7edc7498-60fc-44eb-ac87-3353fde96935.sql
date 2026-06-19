
CREATE OR REPLACE FUNCTION public.search_club_members_enriched(p_club_id uuid, p_search text, p_scope text DEFAULT 'relevant'::text)
RETURNS TABLE(
  id uuid, club_id uuid, telegram_user_id bigint, telegram_username text,
  telegram_first_name text, telegram_last_name text, in_chat boolean, in_channel boolean,
  profile_id uuid, link_status text, access_status text,
  created_at timestamptz, updated_at timestamptz,
  auth_user_id uuid, email text, full_name text, phone text, external_id_amo text,
  has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean,
  is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean,
  access_started_at timestamptz, access_ended_at timestamptz, commercial_ended_at timestamptz,
  kicked_at timestamptz, kicked_at_source text, is_commercial_orphan boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user_id uuid; v_q text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (NOT public.has_role(v_user_id, 'admin'::app_role) AND NOT public.has_role(v_user_id, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  v_q := '%' || lower(coalesce(p_search,'')) || '%';
  RETURN QUERY
  SELECT v.id, v.club_id, v.telegram_user_id, v.telegram_username, v.telegram_first_name, v.telegram_last_name,
    v.in_chat, v.in_channel, v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any AND v.access_status != 'removed') AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown,
    v.access_started_at, v.access_ended_at, v.commercial_ended_at, v.kicked_at, v.kicked_at_source, v.is_commercial_orphan
  FROM public.v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (p_scope = 'all'
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false)
          AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))))
    AND (
      lower(coalesce(v.telegram_username,'')) LIKE v_q
      OR lower(coalesce(v.telegram_first_name,'')) LIKE v_q
      OR lower(coalesce(v.telegram_last_name,'')) LIKE v_q
      OR lower(coalesce(v.full_name,'')) LIKE v_q
      OR lower(coalesce(v.email,'')) LIKE v_q
      OR lower(coalesce(v.phone,'')) LIKE v_q
      OR lower(coalesce(v.external_id_amo,'')) LIKE v_q
      OR v.telegram_user_id::text LIKE v_q
    )
  ORDER BY v.access_status, v.email NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) TO authenticated, service_role;
