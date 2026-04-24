CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience(_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _uid uuid := auth.uid();
BEGIN
  -- Allow system context (service_role / cron) — auth.uid() is NULL there.
  -- For interactive callers, require entitlements.manage permission as before.
  IF _uid IS NOT NULL AND NOT public.has_permission(_uid, 'entitlements.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ids AS (
    SELECT * FROM public.resolve_broadcast_audience_user_ids(_filters)
  ),
  counts AS (
    SELECT
      count(*)::int AS total_count,
      count(*) FILTER (WHERE has_telegram)::int AS telegram_count,
      count(*) FILTER (WHERE has_email)::int AS email_count
    FROM ids
  ),
  sample AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'user_id', p.user_id,
      'full_name', p.full_name,
      'email', p.email,
      'telegram_username', p.telegram_username,
      'has_telegram', (p.telegram_user_id IS NOT NULL),
      'has_email', (p.email IS NOT NULL AND length(p.email) > 0)
    ) ORDER BY p.full_name NULLS LAST) AS users
    FROM (SELECT i.user_id FROM ids i LIMIT 50) sub
    JOIN profiles p ON p.user_id = sub.user_id
  )
  SELECT jsonb_build_object(
    'total_count', counts.total_count,
    'telegram_count', counts.telegram_count,
    'email_count', counts.email_count,
    'users', COALESCE(sample.users, '[]'::jsonb)
  )
  INTO _result
  FROM counts, sample;

  RETURN _result;
END;
$function$;