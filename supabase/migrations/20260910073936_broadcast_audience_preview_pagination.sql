-- Paginate the preview only; preserve audience resolvers, counts and permissions.
CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience(_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _page_offset integer := GREATEST(0, COALESCE((_filters->>'__preview_offset')::integer, 0));
  _page_limit integer := LEAST(100, GREATEST(1, COALESCE((_filters->>'__preview_limit')::integer, 50)));
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH contacts AS (
    SELECT * FROM public.resolve_broadcast_audience_contacts(_filters)
  ),
  tg AS (
    SELECT * FROM public.resolve_broadcast_audience_user_ids(_filters)
  ),
  counts AS (
    SELECT
      (SELECT count(*) FROM contacts)::int AS email_count,
      (SELECT count(*) FROM contacts WHERE NOT is_archived)::int AS email_active_count,
      (SELECT count(*) FROM contacts WHERE is_archived)::int AS email_archived_count,
      (SELECT count(*) FROM contacts WHERE NOT has_account)::int AS email_no_account_count,
      (SELECT count(*) FROM tg WHERE has_telegram)::int AS telegram_count
  ),
  total AS (
    SELECT (
      (SELECT count(*) FROM contacts) +
      (SELECT count(*) FROM tg WHERE has_telegram
        AND user_id NOT IN (SELECT user_id FROM contacts WHERE user_id IS NOT NULL))
    )::int AS total_count
  ),
  recipients AS (
    SELECT c.profile_id, c.user_id, c.full_name, c.email, c.telegram_username,
      c.has_telegram, true AS has_email, c.has_account, c.is_archived
    FROM contacts c
    UNION ALL
    -- Include Telegram recipients counted above but absent from email contacts.
    SELECT COALESCE(p.id, t.user_id), t.user_id, p.full_name, p.email,
      p.telegram_username, true, false, true,
      COALESCE(p.is_archived, false) OR COALESCE(p.status = 'archived', false)
    FROM tg t
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.full_name, pr.email, pr.telegram_username, pr.is_archived, pr.status
      FROM public.profiles pr WHERE pr.user_id = t.user_id
      ORDER BY pr.id LIMIT 1
    ) p ON true
    WHERE t.has_telegram AND t.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = t.user_id)
  ),
  sample AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.profile_id,
      'profile_id', c.profile_id,
      'user_id', c.user_id,
      'full_name', c.full_name,
      'email', c.email,
      'telegram_username', c.telegram_username,
      'has_telegram', c.has_telegram,
      'has_email', c.has_email,
      'has_account', c.has_account,
      'is_archived', c.is_archived
    ) ORDER BY c.full_name NULLS LAST, c.profile_id) AS users
    FROM (
      SELECT * FROM recipients ORDER BY full_name NULLS LAST, profile_id
      LIMIT _page_limit OFFSET _page_offset
    ) c
  )
  SELECT jsonb_build_object(
    'total_count', total.total_count,
    'telegram_count', counts.telegram_count,
    'email_count', counts.email_count,
    'email_active_count', counts.email_active_count,
    'email_archived_count', counts.email_archived_count,
    'email_no_account_count', counts.email_no_account_count,
    'users', COALESCE(sample.users, '[]'::jsonb),
    'page_offset', _page_offset,
    'page_limit', _page_limit
  )
  INTO _result
  FROM counts, total, sample;

  RETURN _result;
END;
$function$;
