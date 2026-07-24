DROP FUNCTION IF EXISTS public.search_deal_rows(text, uuid, timestamptz, timestamptz, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_profiles_with_paid_orders(integer, integer, text);
DROP FUNCTION IF EXISTS public.get_duplicate_contact_profiles(integer, integer, text);

CREATE OR REPLACE FUNCTION public.search_profile_ids_by_company(p_query text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT cc.profile_id
  FROM public.company_contacts cc
  JOIN public.companies c ON c.id = cc.company_id
  WHERE cc.profile_id IS NOT NULL
    AND c.status <> 'merged'
    AND (
      coalesce(c.full_name, '') ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(c.short_name, '') ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(c.public_id, '') ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(c.unp_normalized, '') ILIKE '%' || btrim(p_query) || '%'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.search_profile_ids_by_company(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profile_ids_by_company(text) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_deal_tab_counts(
  p_search text DEFAULT NULL, p_product_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  WITH base AS (
    SELECT o.id, o.status, o.is_trial, o.reconcile_source
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    LEFT JOIN products_v2 pr ON pr.id = o.product_id
    LEFT JOIN tariffs t ON t.id = o.tariff_id
    WHERE (p_product_id IS NULL OR o.product_id = p_product_id)
      AND (p_date_from IS NULL OR o.deal_date >= p_date_from)
      AND (p_date_to IS NULL OR o.deal_date <= p_date_to)
      AND (
        p_search IS NULL OR o.order_number ILIKE '%'||p_search||'%'
        OR o.customer_email ILIKE '%'||p_search||'%' OR o.customer_phone ILIKE '%'||p_search||'%'
        OR p.full_name ILIKE '%'||p_search||'%' OR p.email ILIKE '%'||p_search||'%'
        OR pr.name ILIKE '%'||p_search||'%' OR pr.code ILIKE '%'||p_search||'%' OR t.name ILIKE '%'||p_search||'%'
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id = o.company_id AND c.status <> 'merged'
            AND (c.full_name ILIKE '%'||p_search||'%' OR c.short_name ILIKE '%'||p_search||'%' OR c.public_id ILIKE '%'||p_search||'%' OR c.unp_normalized ILIKE '%'||p_search||'%')
        )
      )
  )
  SELECT jsonb_build_object(
    'all',(SELECT count(*) FROM base), 'paid',(SELECT count(*) FROM base WHERE status='paid'),
    'pending',(SELECT count(*) FROM base WHERE status='pending'), 'failed',(SELECT count(*) FROM base WHERE status='failed'),
    'trial',(SELECT count(*) FROM base WHERE is_trial=true), 'canceled',(SELECT count(*) FROM base WHERE status IN ('canceled','refunded')),
    'imported',(SELECT count(*) FROM base WHERE reconcile_source IN ('bepaid_archive_import','getcourse_historical','csv_active_import'))
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_deal_rows(
  p_search text DEFAULT NULL, p_product_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL,
  p_preset text DEFAULT 'all', p_limit int DEFAULT 100, p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_number text, status text, deal_date timestamptz, created_at timestamptz,
  customer_email text, customer_phone text, final_price numeric, currency text,
  discount_percent numeric, is_trial boolean, trial_end_at timestamptz, product_id uuid,
  tariff_id uuid, user_id uuid, profile_id uuid, reconcile_source text,
  purchase_snapshot jsonb, meta jsonb, product_name text, product_code text, tariff_name text,
  profile_full_name text, profile_email text, profile_phone text, profile_avatar_url text,
  profile_user_id uuid, latest_payment_id uuid, latest_payment_status text,
  latest_payment_paid_at timestamptz, latest_payment_card_holder text, latest_payment_meta jsonb
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.status::text, o.deal_date, o.created_at,
    o.customer_email, o.customer_phone, o.final_price, o.currency, o.discount_percent,
    o.is_trial, o.trial_end_at, o.product_id, o.tariff_id, o.user_id, o.profile_id,
    o.reconcile_source, o.purchase_snapshot, o.meta, pr.name, pr.code, t.name,
    p.full_name, p.email, p.phone, p.avatar_url, p.user_id,
    pay.id, pay.status::text, pay.paid_at, pay.card_holder, pay.meta
  FROM orders_v2 o
  LEFT JOIN profiles p ON p.id = o.profile_id
  LEFT JOIN products_v2 pr ON pr.id = o.product_id
  LEFT JOIN tariffs t ON t.id = o.tariff_id
  LEFT JOIN LATERAL (
    SELECT pay2.id, pay2.status, pay2.paid_at, pay2.card_holder, pay2.meta
    FROM payments_v2 pay2 WHERE pay2.order_id = o.id
    ORDER BY COALESCE(pay2.paid_at, pay2.created_at) DESC LIMIT 1
  ) pay ON true
  WHERE (p_preset='all' OR p_preset IS NULL
      OR (p_preset='trial' AND o.is_trial=true)
      OR (p_preset='canceled' AND o.status IN ('canceled','refunded'))
      OR (p_preset='imported' AND o.reconcile_source IN ('bepaid_archive_import','getcourse_historical','csv_active_import')))
    AND (p_product_id IS NULL OR o.product_id=p_product_id)
    AND (p_date_from IS NULL OR o.deal_date>=p_date_from)
    AND (p_date_to IS NULL OR o.deal_date<=p_date_to)
    AND (
      p_search IS NULL OR o.order_number ILIKE '%'||p_search||'%'
      OR o.customer_email ILIKE '%'||p_search||'%' OR o.customer_phone ILIKE '%'||p_search||'%'
      OR p.full_name ILIKE '%'||p_search||'%' OR p.email ILIKE '%'||p_search||'%'
      OR pr.name ILIKE '%'||p_search||'%' OR pr.code ILIKE '%'||p_search||'%' OR t.name ILIKE '%'||p_search||'%'
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id=o.company_id AND c.status <> 'merged'
          AND (c.full_name ILIKE '%'||p_search||'%' OR c.short_name ILIKE '%'||p_search||'%' OR c.public_id ILIKE '%'||p_search||'%' OR c.unp_normalized ILIKE '%'||p_search||'%')
      )
    )
  ORDER BY o.deal_date DESC NULLS LAST, o.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_global(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts jsonb; v_deals jsonb; v_messages jsonb; v_companies jsonb; v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.has_role(v_user_id,'admin'::app_role) OR public.has_role(v_user_id,'superadmin'::app_role)
    OR public.has_permission(v_user_id,'users.view')
    OR public.has_admin_section_access(v_user_id,'contacts','view')
    OR public.has_admin_section_access(v_user_id,'deals','view')
    OR public.has_admin_section_access(v_user_id,'communication','view')
  ) THEN RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE='42501'; END IF;

  SELECT coalesce(jsonb_agg(row_to_json(c)),'[]'::jsonb) INTO v_contacts FROM (
    SELECT p.id AS profile_id, p.full_name, p.email, p.phone, p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple', coalesce(p.full_name,'')||' '||coalesce(p.email,'')||' '||coalesce(p.phone,'')||' '||coalesce(p.telegram_username,'')) @@ websearch_to_tsquery('simple',p_query)
       OR EXISTS (
         SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id=cc.company_id
         WHERE cc.profile_id=p.id AND c.status <> 'merged'
           AND (c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.public_id ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
       )
    LIMIT p_limit OFFSET p_offset
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)),'[]'::jsonb) INTO v_deals FROM (
    SELECT o.id AS order_id, o.order_number, o.status::text, o.profile_id, o.customer_email, o.customer_phone, p.full_name AS contact_name
    FROM orders_v2 o LEFT JOIN profiles p ON p.id=o.profile_id
    WHERE to_tsvector('simple', coalesce(o.order_number,'')||' '||coalesce(o.customer_email,'')||' '||coalesce(o.customer_phone,'')) @@ websearch_to_tsquery('simple',p_query)
       OR EXISTS (
         SELECT 1 FROM public.companies c
         WHERE c.id=o.company_id AND c.status <> 'merged'
           AND (c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.public_id ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
       )
    LIMIT p_limit OFFSET p_offset
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)),'[]'::jsonb) INTO v_messages FROM (
    SELECT tm.id, 'private'::text AS source, left(tm.message_text,150) AS snippet, tm.created_at,
      tm.user_id, tm.telegram_user_id, NULL::bigint AS chat_id, p.id AS profile_id, p.full_name AS contact_name
    FROM telegram_messages tm LEFT JOIN profiles p ON p.user_id=tm.user_id
    WHERE to_tsvector('simple',coalesce(tm.message_text,'')) @@ websearch_to_tsquery('simple',p_query)
    LIMIT p_limit OFFSET p_offset
  ) m;

  IF (public.has_role_v2(v_user_id,'super_admin') OR public.has_role_v2(v_user_id,'admin') OR public.has_role_v2(v_user_id,'menedzher') OR public.has_role_v2(v_user_id,'support')) THEN
    SELECT coalesce(jsonb_agg(row_to_json(c)),'[]'::jsonb) INTO v_companies FROM (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized, c.country, c.company_kind, c.status, 'company'::text AS entity
      FROM public.companies c
      WHERE c.status <> 'merged' AND (c.public_id ILIKE '%'||p_query||'%' OR c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
      LIMIT p_limit OFFSET p_offset
    ) c;
  ELSE v_companies := '[]'::jsonb; END IF;

  RETURN jsonb_build_object('contacts',v_contacts,'deals',v_deals,'messages',v_messages,'companies',v_companies);
END;
$function$;

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