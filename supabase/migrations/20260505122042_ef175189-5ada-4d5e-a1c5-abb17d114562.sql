
DROP FUNCTION IF EXISTS public.admin_get_club_memberships_all(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_club_memberships_all(p_profile_id uuid)
 RETURNS TABLE(
   club_id uuid,
   club_name text,
   is_active_club boolean,
   club_has_chat boolean,
   club_has_channel boolean,
   in_chat boolean,
   in_channel boolean,
   access_status text,
   link_status text,
   invite_status text,
   invite_sent_at timestamp with time zone,
   last_telegram_check_at timestamp with time zone,
   last_verified_at timestamp with time zone,
   member_updated_at timestamp with time zone,
   club_last_status_check_at timestamp with time zone,
   club_last_members_sync_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
    RAISE EXCEPTION 'access denied: entitlements.manage permission required';
  END IF;

  RETURN QUERY
  SELECT
    tcm.club_id,
    tc.club_name,
    tc.is_active,
    (tc.chat_id IS NOT NULL) AS club_has_chat,
    (tc.channel_id IS NOT NULL) AS club_has_channel,
    tcm.in_chat,
    tcm.in_channel,
    tcm.access_status::text,
    tcm.link_status::text,
    tcm.invite_status::text,
    tcm.invite_sent_at,
    tcm.last_telegram_check_at,
    tcm.last_verified_at,
    tcm.updated_at,
    tc.last_status_check_at,
    tc.last_members_sync_at
  FROM telegram_club_members tcm
  JOIN telegram_clubs tc ON tc.id = tcm.club_id
  WHERE tcm.profile_id = p_profile_id
    AND tc.is_active = true
  ORDER BY
    (CASE WHEN tcm.in_chat = TRUE OR tcm.in_channel = TRUE THEN 0 ELSE 1 END) ASC,
    tc.club_name ASC;
END;
$function$;
