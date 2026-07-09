CREATE OR REPLACE FUNCTION public.get_contact_tab_counts(p_search text DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prof AS (
    SELECT p.*
    FROM public.profiles p
    WHERE p_search IS NULL
       OR (
         coalesce(p.email,'') ilike '%'||p_search||'%'
         OR coalesce(p.full_name,'') ilike '%'||p_search||'%'
         OR coalesce(p.phone,'') ilike '%'||p_search||'%'
       )
  ),
  visible_prof AS (
    SELECT *
    FROM prof
    WHERE coalesce(is_archived, false) = false
      AND status <> 'archived'
      AND merged_to_profile_id IS NULL
  ),
  duplicate_keys AS (
    SELECT kind, key
    FROM (
      SELECT 'email'::text AS kind, lower(trim(email)) AS key
      FROM visible_prof
      WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
      UNION ALL
      SELECT 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key
      FROM visible_prof
      WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
    ) k
    WHERE key <> ''
    GROUP BY kind, key
    HAVING count(*) > 1
  ),
  duplicate_profile_ids AS (
    SELECT DISTINCT k.profile_id
    FROM (
      SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key
      FROM visible_prof
      WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
      UNION ALL
      SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key
      FROM visible_prof
      WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
    ) k
    JOIN duplicate_keys dk ON dk.kind = k.kind AND dk.key = k.key
  ),
  paid_profiles AS (
    SELECT DISTINCT o.profile_id
    FROM public.orders_v2 o
    JOIN visible_prof p ON p.id = o.profile_id
    WHERE o.status = 'paid'
      AND o.profile_id IS NOT NULL
  )
  SELECT json_build_object(
    'all',        (SELECT count(*) FROM visible_prof),
    'active',     (SELECT count(*) FROM visible_prof WHERE user_id IS NOT NULL),
    'no_account', (SELECT count(*) FROM visible_prof WHERE user_id IS NULL),
    'duplicates', (SELECT count(*) FROM duplicate_profile_ids),
    'archived',   (SELECT count(*) FROM prof WHERE status = 'archived' OR coalesce(is_archived, false) = true OR merged_to_profile_id IS NOT NULL),
    'with_deals', (SELECT count(*) FROM paid_profiles),
    'banned',     (SELECT count(*) FROM visible_prof WHERE status = 'banned')
  );
$$;

REVOKE ALL ON FUNCTION public.get_contact_tab_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_tab_counts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_tab_counts(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_duplicate_contact_profiles(
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible_prof AS (
    SELECT p.*
    FROM public.profiles p
    WHERE coalesce(p.is_archived, false) = false
      AND p.status <> 'archived'
      AND p.merged_to_profile_id IS NULL
      AND (
        p_search IS NULL
        OR coalesce(p.email,'') ilike '%'||p_search||'%'
        OR coalesce(p.full_name,'') ilike '%'||p_search||'%'
        OR coalesce(p.phone,'') ilike '%'||p_search||'%'
      )
  ),
  keys AS (
    SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key
    FROM visible_prof
    WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
    UNION ALL
    SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key
    FROM visible_prof
    WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
  ),
  duplicate_keys AS (
    SELECT kind, key
    FROM keys
    WHERE key <> ''
    GROUP BY kind, key
    HAVING count(*) > 1
  ),
  duplicate_profile_ids AS (
    SELECT DISTINCT k.profile_id
    FROM keys k
    JOIN duplicate_keys dk ON dk.kind = k.kind AND dk.key = k.key
  )
  SELECT p.*
  FROM visible_prof p
  JOIN duplicate_profile_ids d ON d.profile_id = p.id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT greatest(p_limit, 0)
  OFFSET greatest(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.get_duplicate_contact_profiles(int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_duplicate_contact_profiles(int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_duplicate_contact_profiles(int, int, text) TO service_role;