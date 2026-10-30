-- Only the two disabled-by-default pilot functions use this RPC. No session writes.
-- Limits must match verified Auth policy; explicit NULL means the limit is off.
-- The managed migration runner owns the transaction.
CREATE OR REPLACE FUNCTION public.video_pilot_session_is_live(
  _sid uuid, _uid uuid, _max_idle_seconds integer, _max_age_seconds integer, _single_session boolean
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    (_max_idle_seconds IS NULL OR _max_idle_seconds BETWEEN 1 AND 31536000)
    AND (_max_age_seconds IS NULL OR _max_age_seconds BETWEEN 1 AND 31536000)
    AND _single_session IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
      WHERE s.id = _sid AND s.user_id = _uid
        AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id AND p.status = 'active'
          AND NOT COALESCE(p.is_archived, false) AND p.merged_to_profile_id IS NULL)
        AND (s.not_after IS NULL OR s.not_after > now())
        AND s.created_at <= now()
        AND (_max_age_seconds IS NULL OR s.created_at + make_interval(secs => _max_age_seconds) > now())
        -- GoTrue stores refreshed_at as a UTC timestamp without time zone.
        AND COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.created_at) <= now()
        AND (_max_idle_seconds IS NULL OR COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.created_at) + make_interval(secs => _max_idle_seconds) > now())
        AND (NOT _single_session OR NOT EXISTS (
          SELECT 1 FROM auth.sessions newer WHERE newer.user_id = s.user_id AND newer.created_at > s.created_at
        ))
    ), false);
$function$;
REVOKE ALL ON FUNCTION public.video_pilot_session_is_live(uuid,uuid,integer,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_pilot_session_is_live(uuid,uuid,integer,integer,boolean) TO service_role;
COMMENT ON FUNCTION public.video_pilot_session_is_live(uuid,uuid,integer,integer,boolean)
IS 'Synthetic DRM pilot only. Live session validity; not production lesson entitlement. Service role only.';
