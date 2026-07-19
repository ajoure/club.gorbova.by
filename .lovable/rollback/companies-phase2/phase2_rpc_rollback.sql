BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.crm_company_upsert_from_billing(uuid);
DROP FUNCTION IF EXISTS public.search_companies(jsonb);
DROP FUNCTION IF EXISTS public.crm_company_merge(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_company_archive(uuid, text);
DROP FUNCTION IF EXISTS public.crm_company_grp_refetch(uuid);
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT id INTO v_id FROM public.companies
    WHERE country=_country AND unp_normalized=_unp AND status <> 'merged' LIMIT 1;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.search_global(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts jsonb;
  v_deals jsonb;
  v_messages jsonb;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_user_id, 'admin'::app_role)
    OR public.has_role(v_user_id, 'superadmin'::app_role)
    OR public.has_permission(v_user_id, 'users.view')
    OR public.has_admin_section_access(v_user_id, 'contacts', 'view')
    OR public.has_admin_section_access(v_user_id, 'deals', 'view')
    OR public.has_admin_section_access(v_user_id, 'communication', 'view')
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT p.id as profile_id, p.full_name, p.email, p.phone,
           p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple',
      coalesce(p.full_name, '') || ' ' ||
      coalesce(p.email, '') || ' ' ||
      coalesce(p.phone, '') || ' ' ||
      coalesce(p.telegram_username, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_deals
  FROM (
    SELECT o.id as order_id, o.order_number, o.status::text, o.profile_id,
           o.customer_email, o.customer_phone, p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE to_tsvector('simple',
      coalesce(o.order_number, '') || ' ' ||
      coalesce(o.customer_email, '') || ' ' ||
      coalesce(o.customer_phone, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages
  FROM (
    SELECT
      tm.id,
      'private'::text as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,
      NULL::bigint as chat_id,
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE to_tsvector('simple', coalesce(tm.message_text, ''))
          @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) m;

  RETURN jsonb_build_object(
    'contacts', v_contacts,
    'deals',    v_deals,
    'messages', v_messages
  );
END;
$function$;
-- сначала resolve helper (его вызывали удалённые в §12.2 RPC)
DROP FUNCTION IF EXISTS public._crm_company_resolve_or_create_internal(
  text, text, text, text, uuid, text, uuid);
-- затем emit helper (его вызывали все Phase 2 RPC и resolve helper)
DROP FUNCTION IF EXISTS public._crm_company_emit_domain_event(
  text, uuid, text, jsonb);
-- shared-таблица domain_events не трогается — DDL не создавался
REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  TO authenticated;
-- search_global ACL остаётся идентичным фактическому pre-Phase-2: authenticated/service_role=EXECUTE, anon/PUBLIC=none
COMMIT;
