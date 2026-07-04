CREATE OR REPLACE FUNCTION public.admin_create_or_get_support_ticket_for_profile(
  p_profile_id uuid,
  p_subject text,
  p_description text,
  p_category text DEFAULT 'general',
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_user_id uuid;
  v_existing_ticket public.support_tickets%ROWTYPE;
  v_new_ticket public.support_tickets%ROWTYPE;
  v_subject text;
  v_description text;
  v_category text;
  v_admin_name text;
BEGIN
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_authenticated', 'error', 'Требуется авторизация');
  END IF;

  IF NOT (public.has_permission(v_admin, 'support.manage') OR public.has_permission(v_admin, 'admins.manage')) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden', 'error', 'Недостаточно прав');
  END IF;

  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'profile_required', 'error', 'profile_id обязателен');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('admin_init_ticket:' || p_profile_id::text));

  SELECT user_id INTO v_user_id FROM public.profiles WHERE id = p_profile_id;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'profile_has_no_user', 'error', 'Профиль не связан с пользователем — тикет не будет виден клиенту');
  END IF;

  SELECT * INTO v_existing_ticket
  FROM public.support_tickets
  WHERE profile_id = p_profile_id
    AND status IN ('open', 'in_progress', 'waiting_user')
    AND merged_into_ticket_id IS NULL
  ORDER BY updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'ticket_id', v_existing_ticket.id,
      'ticket_number', v_existing_ticket.ticket_number,
      'created_new', false,
      'status', v_existing_ticket.status
    );
  END IF;

  v_subject := btrim(coalesce(p_subject, ''));
  v_description := btrim(coalesce(p_description, ''));
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'general');

  IF length(v_subject) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'subject_required', 'error', 'Тема обязательна (минимум 3 символа)');
  END IF;
  IF length(v_description) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'description_required', 'error', 'Первое сообщение обязательно');
  END IF;
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'attachments_invalid', 'error', 'Некорректные вложения');
  END IF;

  SELECT coalesce(full_name, nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email)
  INTO v_admin_name
  FROM public.profiles
  WHERE user_id = v_admin
  LIMIT 1;

  INSERT INTO public.support_tickets (
    profile_id, user_id, subject, description, category, status, priority,
    has_unread_user, has_unread_admin, first_response_at
  ) VALUES (
    p_profile_id, v_user_id, v_subject, v_description, v_category, 'open', 'normal',
    true, false, now()
  )
  RETURNING * INTO v_new_ticket;

  INSERT INTO public.ticket_messages (
    ticket_id, author_id, author_type, author_name, message, attachments, is_internal, is_read, display_user_id
  ) VALUES (
    v_new_ticket.id, v_admin, 'support', v_admin_name, v_description, p_attachments, false, false, v_admin
  );

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_new_ticket.id,
    'ticket_number', v_new_ticket.ticket_number,
    'created_new', true,
    'status', v_new_ticket.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_or_get_support_ticket_for_profile(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_or_get_support_ticket_for_profile(uuid, text, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_create_or_get_support_ticket_for_profile(uuid, text, text, text, jsonb) IS
  'PATCH-CONTACT-CENTER-ADMIN-INITIATE-SUPPORT-TICKET: admin initiates a support ticket for a client from the contact center; dedupe by profile_id + active status.';