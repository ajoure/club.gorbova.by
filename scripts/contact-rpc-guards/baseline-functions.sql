-- Frozen, fully audited query bodies from 20260724211024; synthetic fixture only.

CREATE OR REPLACE FUNCTION public.get_duplicate_contact_profiles(
  p_limit int DEFAULT 100, p_offset int DEFAULT 0, p_search text DEFAULT NULL
)
RETURNS SETOF public.profiles LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH visible_prof AS (
    SELECT p.* FROM public.profiles p
    WHERE coalesce(p.is_archived,false)=false AND p.status <> 'archived' AND p.merged_to_profile_id IS NULL
      AND (
        p_search IS NULL OR coalesce(p.email,'') ILIKE '%'||p_search||'%' OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
        OR EXISTS (
          SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id=cc.company_id
          WHERE cc.profile_id=p.id AND c.status <> 'merged'
            AND (c.full_name ILIKE '%'||p_search||'%' OR c.short_name ILIKE '%'||p_search||'%' OR c.public_id ILIKE '%'||p_search||'%' OR c.unp_normalized ILIKE '%'||p_search||'%')
        )
      )
  ), keys AS (
    SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof WHERE nullif(trim(coalesce(email,'')),'') IS NOT NULL
    UNION ALL SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone,'[^0-9]','','g'),9) AS key FROM visible_prof WHERE length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) >= 7
  ), duplicate_keys AS (
    SELECT kind,key FROM keys WHERE key <> '' GROUP BY kind,key HAVING count(*) > 1
  ), duplicate_profile_ids AS (
    SELECT DISTINCT k.profile_id FROM keys k JOIN duplicate_keys dk ON dk.kind=k.kind AND dk.key=k.key
  )
  SELECT p.* FROM visible_prof p JOIN duplicate_profile_ids d ON d.profile_id=p.id
  ORDER BY p.created_at DESC,p.id DESC LIMIT greatest(p_limit,0) OFFSET greatest(p_offset,0);
$$;

CREATE OR REPLACE FUNCTION public.get_profiles_with_paid_orders(
  p_limit int, p_offset int, p_search text DEFAULT NULL
)
RETURNS TABLE (
  profile_id uuid, user_id uuid, email text, full_name text, first_name text,
  last_name text, phone text, telegram_username text, telegram_user_id bigint,
  status text, is_archived boolean, created_at timestamptz, duplicate_flag text,
  avatar_url text, last_seen_at timestamptz, loyalty_score numeric,
  loyalty_ai_summary text, loyalty_status_reason text, loyalty_proofs jsonb,
  loyalty_analyzed_messages_count int, loyalty_updated_at timestamptz,
  communication_style jsonb, last_paid_at timestamptz, paid_orders_count int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH paid AS (
    SELECT o.profile_id, max(o.created_at) AS last_paid_at, count(*)::int AS paid_orders_count
    FROM public.orders_v2 o
    WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
    GROUP BY o.profile_id
  ), filtered AS (
    SELECT p.id AS profile_id, p.user_id, p.email, p.full_name, p.first_name, p.last_name, p.phone,
      p.telegram_username, p.telegram_user_id, p.status, p.is_archived, p.created_at,
      p.duplicate_flag, p.avatar_url, p.last_seen_at, p.loyalty_score, p.loyalty_ai_summary,
      p.loyalty_status_reason, p.loyalty_proofs, p.loyalty_analyzed_messages_count,
      p.loyalty_updated_at, p.communication_style, paid.last_paid_at, paid.paid_orders_count
    FROM paid JOIN public.profiles p ON p.id = paid.profile_id
    WHERE p_search IS NULL
       OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
       OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%'
       OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
       OR EXISTS (
         SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id = cc.company_id
         WHERE cc.profile_id = p.id AND c.status <> 'merged'
           AND (coalesce(c.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%' OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%')
       )
  )
  SELECT * FROM filtered ORDER BY last_paid_at DESC, profile_id DESC LIMIT p_limit OFFSET p_offset;
$$;

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
       OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
       OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%'
       OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
       OR EXISTS (
         SELECT 1
         FROM public.company_contacts cc
         JOIN public.companies c ON c.id = cc.company_id
         WHERE cc.profile_id = p.id
           AND c.status <> 'merged'
           AND (
             coalesce(c.full_name,'') ILIKE '%'||p_search||'%'
             OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%'
             OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%'
             OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%'
           )
       )
  ),
  visible_prof AS (
    SELECT * FROM prof
    WHERE coalesce(is_archived, false) = false
      AND status <> 'archived'
      AND merged_to_profile_id IS NULL
  ),
  duplicate_keys AS (
    SELECT kind, key FROM (
      SELECT 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof
      WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
      UNION ALL
      SELECT 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key FROM visible_prof
      WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
    ) k WHERE key <> '' GROUP BY kind, key HAVING count(*) > 1
  ),
  duplicate_profile_ids AS (
    SELECT DISTINCT k.profile_id
    FROM (
      SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof
      WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
      UNION ALL
      SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key FROM visible_prof
      WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
    ) k JOIN duplicate_keys dk ON dk.kind = k.kind AND dk.key = k.key
  ),
  paid_profiles AS (
    SELECT DISTINCT o.profile_id FROM public.orders_v2 o
    JOIN visible_prof p ON p.id = o.profile_id
    WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
  )
  SELECT json_build_object(
    'all', (SELECT count(*) FROM visible_prof),
    'active', (SELECT count(*) FROM visible_prof WHERE user_id IS NOT NULL),
    'no_account', (SELECT count(*) FROM visible_prof WHERE user_id IS NULL),
    'duplicates', (SELECT count(*) FROM duplicate_profile_ids),
    'archived', (SELECT count(*) FROM prof WHERE status = 'archived' OR coalesce(is_archived, false) = true OR merged_to_profile_id IS NOT NULL),
    'with_deals', (SELECT count(*) FROM paid_profiles),
    'banned', (SELECT count(*) FROM visible_prof WHERE status = 'banned')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_profiles_with_paid_orders_count(p_search text DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::bigint FROM (
    SELECT DISTINCT o.profile_id
    FROM public.orders_v2 o JOIN public.profiles p ON p.id = o.profile_id
    WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
      AND (
        p_search IS NULL OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
        OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
        OR EXISTS (
          SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id = cc.company_id
          WHERE cc.profile_id = p.id AND c.status <> 'merged'
            AND (coalesce(c.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%' OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%')
        )
      )
  ) t;
$$;
