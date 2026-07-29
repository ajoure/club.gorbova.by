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
    FROM public.profiles p
    WHERE coalesce(p.is_archived,false)=false
      AND coalesce(p.status,'active') <> 'archived'
      AND p.merged_to_profile_id IS NULL
      AND (
        to_tsvector('simple', coalesce(p.full_name,'')||' '||coalesce(p.email,'')||' '||coalesce(p.phone,'')||' '||coalesce(p.telegram_username,'')) @@ websearch_to_tsquery('simple',p_query)
        OR EXISTS (
          SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id=cc.company_id
          WHERE cc.profile_id=p.id AND c.status <> 'merged'
            AND (c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.public_id ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
        )
      )
    LIMIT greatest(coalesce(p_limit,20),0) OFFSET greatest(coalesce(p_offset,0),0)
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)),'[]'::jsonb) INTO v_deals FROM (
    SELECT o.id AS order_id, o.order_number, o.status::text, o.profile_id, o.customer_email, o.customer_phone, p.full_name AS contact_name
    FROM public.orders_v2 o LEFT JOIN public.profiles p ON p.id=o.profile_id
    WHERE to_tsvector('simple', coalesce(o.order_number,'')||' '||coalesce(o.customer_email,'')||' '||coalesce(o.customer_phone,'')) @@ websearch_to_tsquery('simple',p_query)
       OR EXISTS (
         SELECT 1 FROM public.companies c WHERE c.id=o.company_id AND c.status <> 'merged'
           AND (c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.public_id ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
       )
    LIMIT greatest(coalesce(p_limit,20),0) OFFSET greatest(coalesce(p_offset,0),0)
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)),'[]'::jsonb) INTO v_messages FROM (
    SELECT tm.id, 'private'::text AS source, left(tm.message_text,150) AS snippet, tm.created_at,
      tm.user_id, tm.telegram_user_id, NULL::bigint AS chat_id, p.id AS profile_id, p.full_name AS contact_name
    FROM public.telegram_messages tm LEFT JOIN public.profiles p ON p.user_id=tm.user_id
    WHERE to_tsvector('simple',coalesce(tm.message_text,'')) @@ websearch_to_tsquery('simple',p_query)
    LIMIT greatest(coalesce(p_limit,20),0) OFFSET greatest(coalesce(p_offset,0),0)
  ) m;

  IF (public.has_role_v2(v_user_id,'super_admin') OR public.has_role_v2(v_user_id,'admin') OR public.has_role_v2(v_user_id,'menedzher') OR public.has_role_v2(v_user_id,'support')) THEN
    SELECT coalesce(jsonb_agg(row_to_json(c)),'[]'::jsonb) INTO v_companies FROM (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized, c.country, c.company_kind, c.status, 'company'::text AS entity
      FROM public.companies c
      WHERE c.status <> 'merged' AND (c.public_id ILIKE '%'||p_query||'%' OR c.full_name ILIKE '%'||p_query||'%' OR c.short_name ILIKE '%'||p_query||'%' OR c.unp_normalized ILIKE '%'||p_query||'%')
      LIMIT greatest(coalesce(p_limit,20),0) OFFSET greatest(coalesce(p_offset,0),0)
    ) c;
  ELSE v_companies := '[]'::jsonb; END IF;

  RETURN jsonb_build_object('contacts',v_contacts,'deals',v_deals,'messages',v_messages,'companies',v_companies);
END;
$function$;

REVOKE ALL ON FUNCTION public.search_global(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_global(text, integer, integer) TO authenticated, service_role;