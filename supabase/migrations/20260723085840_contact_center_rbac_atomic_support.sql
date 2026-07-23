-- Contact center authorization and atomic support-message delivery.
-- All staff access is aligned with RBAC v3 section `communication`.

-- Telegram: remove legacy role-only policies which otherwise OR together with
-- the RBAC v3 policies and bypass a denied communication section.
DROP POLICY IF EXISTS "Admins can view all telegram messages" ON public.telegram_messages;
DROP POLICY IF EXISTS "Admins can update telegram messages" ON public.telegram_messages;
DROP POLICY IF EXISTS "Admins can insert telegram messages" ON public.telegram_messages;

-- Instagram: replace role-only ALL policies with explicit view/manage gates.
DROP POLICY IF EXISTS "Admin access instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Admin access instagram_messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "Admin access instagram_contacts" ON public.instagram_contacts;

DROP POLICY IF EXISTS "RBAC v3: view instagram accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "RBAC v3: manage instagram accounts" ON public.instagram_accounts;
CREATE POLICY "RBAC v3: view instagram accounts"
  ON public.instagram_accounts FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));
CREATE POLICY "RBAC v3: manage instagram accounts"
  ON public.instagram_accounts FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view instagram messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "RBAC v3: manage instagram messages" ON public.instagram_messages;
CREATE POLICY "RBAC v3: view instagram messages"
  ON public.instagram_messages FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));
CREATE POLICY "RBAC v3: manage instagram messages"
  ON public.instagram_messages FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view instagram contacts" ON public.instagram_contacts;
DROP POLICY IF EXISTS "RBAC v3: manage instagram contacts" ON public.instagram_contacts;
CREATE POLICY "RBAC v3: view instagram contacts"
  ON public.instagram_contacts FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));
CREATE POLICY "RBAC v3: manage instagram contacts"
  ON public.instagram_contacts FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

-- Support: keep end-user ownership policies intact; align staff policies with
-- the same contact-center section while retaining legacy support permissions.
DROP POLICY IF EXISTS "Support can view all tickets" ON public.support_tickets;
CREATE POLICY "Support can view all tickets"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'communication', 'view')
    OR public.has_permission(auth.uid(), 'support.view')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can update all tickets" ON public.support_tickets;
CREATE POLICY "Support can update all tickets"
  ON public.support_tickets FOR UPDATE TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'communication', 'manage')
    OR public.has_permission(auth.uid(), 'support.manage')
    OR public.has_permission(auth.uid(), 'admins.manage')
  )
  WITH CHECK (
    public.has_admin_section_access(auth.uid(), 'communication', 'manage')
    OR public.has_permission(auth.uid(), 'support.manage')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can view all messages" ON public.ticket_messages;
CREATE POLICY "Support can view all messages"
  ON public.ticket_messages FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'communication', 'view')
    OR public.has_permission(auth.uid(), 'support.view')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can create messages" ON public.ticket_messages;
CREATE POLICY "Support can create messages"
  ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.has_admin_section_access(auth.uid(), 'communication', 'manage')
    OR public.has_permission(auth.uid(), 'support.manage')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can view all attachments" ON public.ticket_attachments;
CREATE POLICY "Support can view all attachments"
  ON public.ticket_attachments FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'communication', 'view')
    OR public.has_permission(auth.uid(), 'support.view')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can upload attachments" ON public.ticket_attachments;
CREATE POLICY "Support can upload attachments"
  ON public.ticket_attachments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_admin_section_access(auth.uid(), 'communication', 'manage')
    OR public.has_permission(auth.uid(), 'support.manage')
    OR public.has_permission(auth.uid(), 'admins.manage')
  );

DROP POLICY IF EXISTS "Support can view all ticket attachments storage" ON storage.objects;
CREATE POLICY "Support can view all ticket attachments storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND (
      public.has_admin_section_access(auth.uid(), 'communication', 'view')
      OR public.has_permission(auth.uid(), 'support.view')
      OR public.has_permission(auth.uid(), 'admins.manage')
    )
  );

DROP POLICY IF EXISTS "Support can upload ticket attachments storage" ON storage.objects;
CREATE POLICY "Support can upload ticket attachments storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (
      public.has_admin_section_access(auth.uid(), 'communication', 'manage')
      OR public.has_permission(auth.uid(), 'support.manage')
      OR public.has_permission(auth.uid(), 'admins.manage')
    )
  );

-- One transaction for ticket message + ticket unread/activity state.
CREATE OR REPLACE FUNCTION public.send_ticket_message_v2(
  p_ticket_id uuid,
  p_message text,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_is_internal boolean DEFAULT false,
  p_display_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_is_staff boolean := false;
  v_author_type text;
  v_author_name text;
  v_display_user_id uuid := NULL;
  v_message public.ticket_messages%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_message), '') IS NULL
     AND (p_attachments IS NULL OR p_attachments = '[]'::jsonb) THEN
    RAISE EXCEPTION 'message_or_attachment_required' USING ERRCODE = '22023';
  END IF;
  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'attachments_must_be_array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_is_staff :=
    public.has_admin_section_access(v_actor, 'communication', 'manage')
    OR public.has_permission(v_actor, 'support.manage')
    OR public.has_permission(v_actor, 'admins.manage');

  IF NOT v_is_staff AND v_ticket.user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_is_internal AND NOT v_is_staff THEN
    RAISE EXCEPTION 'internal_note_requires_staff' USING ERRCODE = '42501';
  END IF;

  v_author_type := CASE WHEN v_is_staff THEN 'support' ELSE 'user' END;

  IF v_is_staff AND p_display_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_display_user_id
      AND r.code IN ('super_admin', 'admin', 'support')
  ) THEN
    v_display_user_id := p_display_user_id;
  END IF;

  SELECT NULLIF(btrim(p.full_name), '')
  INTO v_author_name
  FROM public.profiles p
  WHERE p.user_id = COALESCE(v_display_user_id, v_actor)
  LIMIT 1;

  INSERT INTO public.ticket_messages (
    ticket_id,
    author_id,
    author_type,
    author_name,
    message,
    attachments,
    is_internal,
    display_user_id
  )
  VALUES (
    v_ticket.id,
    v_actor,
    v_author_type,
    v_author_name,
    COALESCE(p_message, ''),
    COALESCE(p_attachments, '[]'::jsonb),
    CASE WHEN v_is_staff THEN p_is_internal ELSE false END,
    v_display_user_id
  )
  RETURNING * INTO v_message;

  UPDATE public.support_tickets
  SET
    updated_at = now(),
    has_unread_user = CASE WHEN v_is_staff AND NOT p_is_internal THEN true ELSE has_unread_user END,
    has_unread_admin = CASE WHEN v_is_staff THEN false ELSE true END,
    first_response_at = CASE
      WHEN v_is_staff AND first_response_at IS NULL AND NOT p_is_internal THEN now()
      ELSE first_response_at
    END
  WHERE id = v_ticket.id;

  RETURN jsonb_build_object(
    'success', true,
    'message', to_jsonb(v_message)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_ticket_message_v2(uuid, text, jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_ticket_message_v2(uuid, text, jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_ticket_message_v2(uuid, text, jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_ticket_message_v2(uuid, text, jsonb, boolean, uuid) TO service_role;
