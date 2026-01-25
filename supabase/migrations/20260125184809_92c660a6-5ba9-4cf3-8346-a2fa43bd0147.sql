-- RPC: admin_get_club_membership with permission guard
-- Returns club membership status for admin UI

CREATE OR REPLACE FUNCTION public.admin_get_club_membership(p_profile_id uuid)
RETURNS TABLE (
  access_status text,
  in_chat boolean,
  in_channel boolean,
  club_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: require entitlements.manage permission
  IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
    RAISE EXCEPTION 'access denied: entitlements.manage permission required';
  END IF;

  RETURN QUERY
  SELECT
    tcm.access_status::text,
    tcm.in_chat,
    tcm.in_channel,
    tcm.club_id
  FROM telegram_club_members tcm
  WHERE tcm.profile_id = p_profile_id
  LIMIT 1;
END;
$$;

-- Permissions: authenticated can call, but guard inside enforces real access
REVOKE ALL ON FUNCTION public.admin_get_club_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_club_membership(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_get_club_membership IS 
'Returns club membership status for admin UI. Requires entitlements.manage permission.';