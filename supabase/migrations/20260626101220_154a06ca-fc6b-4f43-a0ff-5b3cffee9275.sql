
-- =====================================================================
-- PATCH-RBAC-V3-DATA-RLS
-- =====================================================================

-- 1. Helper: has_admin_section_access ----------------------------------
CREATE OR REPLACE FUNCTION public.has_admin_section_access(
  _user_id uuid,
  _section_code text,
  _min_level text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rank int;
  v_min  int;
  v_lvl  text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;

  -- Super-admin / admin — always pass
  IF public.has_role(_user_id, 'superadmin'::app_role)
     OR public.has_role(_user_id, 'admin'::app_role)
  THEN
    RETURN true;
  END IF;

  v_min := CASE lower(coalesce(_min_level,'view'))
             WHEN 'manage' THEN 3
             WHEN 'edit'   THEN 2
             ELSE 1
           END;

  -- Section-level access (resource_code IS NULL row, highest level wins)
  SELECT access_level INTO v_lvl
  FROM public.get_admin_access(_user_id)
  WHERE section_code = _section_code
    AND resource_code IS NULL
  ORDER BY CASE access_level
             WHEN 'manage' THEN 3
             WHEN 'edit'   THEN 2
             WHEN 'view'   THEN 1
             ELSE 0
           END DESC
  LIMIT 1;

  IF v_lvl IS NULL THEN RETURN false; END IF;

  v_rank := CASE v_lvl
              WHEN 'manage' THEN 3
              WHEN 'edit'   THEN 2
              WHEN 'view'   THEN 1
              ELSE 0
            END;

  RETURN v_rank >= v_min;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_admin_section_access(uuid, text, text)
  TO authenticated, service_role;

-- 2. Smart has_permission (legacy + RBAC v3 mapping) -------------------
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section text;
  v_level   text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;

  -- 1) Legacy table check (unchanged behaviour)
  IF EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id
      AND p.code = _permission_code
  ) THEN
    RETURN true;
  END IF;

  -- 2) RBAC v3 fallback: map legacy code -> (section, min_level)
  CASE _permission_code
    WHEN 'users.view'         THEN v_section := 'contacts';      v_level := 'view';
    WHEN 'users.update'       THEN v_section := 'contacts';      v_level := 'edit';
    WHEN 'users.block'        THEN v_section := 'contacts';      v_level := 'manage';
    WHEN 'users.delete'       THEN v_section := 'contacts';      v_level := 'manage';
    WHEN 'deals.view'         THEN v_section := 'deals';         v_level := 'view';
    WHEN 'deals.edit'         THEN v_section := 'deals';         v_level := 'edit';
    WHEN 'deals.manage'       THEN v_section := 'deals';         v_level := 'manage';
    WHEN 'deals.delete'       THEN v_section := 'deals';         v_level := 'manage';
    WHEN 'deals.create'       THEN v_section := 'deals';         v_level := 'edit';
    WHEN 'payments.view'      THEN v_section := 'payments';      v_level := 'view';
    WHEN 'payments.manage'    THEN v_section := 'payments';      v_level := 'manage';
    WHEN 'entitlements.view'  THEN v_section := 'payments';      v_level := 'view';
    WHEN 'entitlements.manage'THEN v_section := 'payments';      v_level := 'manage';
    WHEN 'support.view'       THEN v_section := 'support';       v_level := 'view';
    WHEN 'support.manage'     THEN v_section := 'support';       v_level := 'edit';
    WHEN 'telegram.view'      THEN v_section := 'communication'; v_level := 'view';
    WHEN 'telegram.manage'    THEN v_section := 'communication'; v_level := 'manage';
    WHEN 'roles.view'         THEN v_section := 'roles';         v_level := 'view';
    WHEN 'roles.manage'       THEN v_section := 'roles';         v_level := 'manage';
    WHEN 'admins.manage'      THEN v_section := 'roles';         v_level := 'manage';
    WHEN 'news.view'          THEN v_section := 'editorial';     v_level := 'view';
    WHEN 'news.edit'          THEN v_section := 'editorial';     v_level := 'edit';
    WHEN 'content.edit'       THEN v_section := 'editorial';     v_level := 'edit';
    WHEN 'audit.view'         THEN v_section := 'roles';         v_level := 'view';
    ELSE
      RETURN false;
  END CASE;

  RETURN public.has_admin_section_access(_user_id, v_section, v_level);
END;
$$;

-- 3. RLS additions on data tables --------------------------------------
-- profiles already use has_permission → теперь автоматически работает.
-- Дополним только VIEW-политику профайла (она уже OK).

-- orders_v2: add RBAC v3 view + manage
DROP POLICY IF EXISTS "RBAC v3: view orders by deals section" ON public.orders_v2;
CREATE POLICY "RBAC v3: view orders by deals section"
  ON public.orders_v2 FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'deals', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage orders by deals section" ON public.orders_v2;
CREATE POLICY "RBAC v3: manage orders by deals section"
  ON public.orders_v2 FOR ALL
  USING (public.has_admin_section_access(auth.uid(), 'deals', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'deals', 'manage'));

-- payments_v2
DROP POLICY IF EXISTS "RBAC v3: view payments by payments section" ON public.payments_v2;
CREATE POLICY "RBAC v3: view payments by payments section"
  ON public.payments_v2 FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage payments by payments section" ON public.payments_v2;
CREATE POLICY "RBAC v3: manage payments by payments section"
  ON public.payments_v2 FOR ALL
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'payments', 'manage'));

-- email_inbox
DROP POLICY IF EXISTS "RBAC v3: view emails by communication section" ON public.email_inbox;
CREATE POLICY "RBAC v3: view emails by communication section"
  ON public.email_inbox FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage emails by communication section" ON public.email_inbox;
CREATE POLICY "RBAC v3: manage emails by communication section"
  ON public.email_inbox FOR ALL
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

-- telegram_messages
DROP POLICY IF EXISTS "RBAC v3: view tg messages by communication section" ON public.telegram_messages;
CREATE POLICY "RBAC v3: view tg messages by communication section"
  ON public.telegram_messages FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage tg messages by communication section" ON public.telegram_messages;
CREATE POLICY "RBAC v3: manage tg messages by communication section"
  ON public.telegram_messages FOR ALL
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

-- tg_chat_messages
DROP POLICY IF EXISTS "RBAC v3: view chat messages by communication section" ON public.tg_chat_messages;
CREATE POLICY "RBAC v3: view chat messages by communication section"
  ON public.tg_chat_messages FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage chat messages by communication section" ON public.tg_chat_messages;
CREATE POLICY "RBAC v3: manage chat messages by communication section"
  ON public.tg_chat_messages FOR ALL
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

-- support_tickets (admin-side view already uses support.view/manage via has_permission;
-- has_permission now also resolves to support section. No extra policy needed.)

-- 4. search_global: open up to RBAC v3 sections ------------------------
CREATE OR REPLACE FUNCTION public.search_global(
  p_query text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.search_global(text, integer, integer)
  TO authenticated;
