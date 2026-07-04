CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_description text,
  p_category text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_existing_id uuid;
  v_existing_number text;
  v_existing_status text;
  v_ticket_id uuid;
  v_ticket_number text;
  v_message_id uuid;
  v_body text := NULLIF(trim(p_description), '');
  v_subject text := NULLIF(trim(COALESCE(p_subject, '')), '');
  v_attachments jsonb := COALESCE(p_attachments, '[]'::jsonb);
  v_created_new boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not authenticated', 'error_code', 'not_authenticated');
  END IF;

  SELECT id INTO v_profile_id FROM profiles WHERE user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found', 'error_code', 'profile_not_found');
  END IF;

  IF v_body IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Description is required', 'error_code', 'description_required');
  END IF;

  IF jsonb_typeof(v_attachments) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Attachments must be an array', 'error_code', 'attachments_invalid');
  END IF;

  -- Race protection without unique index / trigger: serialize per user in this txn
  PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::text));

  -- Canonical dedupe key = profile_id (NOT NULL); prefer newest active ticket
  SELECT id, ticket_number, status
    INTO v_existing_id, v_existing_number, v_existing_status
  FROM support_tickets
  WHERE profile_id = v_profile_id
    AND status IN ('open','in_progress','waiting_user')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    -- Append message to existing active ticket
    INSERT INTO ticket_messages (ticket_id, author_id, author_type, message, attachments, is_internal, is_read)
    VALUES (v_existing_id, v_user_id, 'user', v_body, v_attachments, false, false)
    RETURNING id INTO v_message_id;

    UPDATE support_tickets
    SET has_unread_admin = true,
        -- has_unread_user intentionally NOT touched: client's own message must not mark unread for client
        status = CASE WHEN status = 'waiting_user' THEN 'open' ELSE status END,
        updated_at = now()
    WHERE id = v_existing_id
    RETURNING status INTO v_existing_status;

    v_ticket_id := v_existing_id;
    v_ticket_number := v_existing_number;
  ELSE
    -- Subject required only for brand new tickets
    IF v_subject IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Subject is required', 'error_code', 'subject_required');
    END IF;

    v_ticket_number := generate_ticket_number_atomic();

    INSERT INTO support_tickets (
      user_id, profile_id, subject, description, category,
      ticket_number, status, priority, has_unread_admin, has_unread_user, updated_at
    ) VALUES (
      v_user_id, v_profile_id, v_subject, v_body, COALESCE(p_category, 'general'),
      v_ticket_number, 'open', 'normal', true, false, now()
    )
    RETURNING id INTO v_ticket_id;

    INSERT INTO ticket_messages (ticket_id, author_id, author_type, message, attachments, is_internal, is_read)
    VALUES (v_ticket_id, v_user_id, 'user', v_body, v_attachments, false, false)
    RETURNING id INTO v_message_id;

    v_created_new := true;
    v_existing_status := 'open';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number,
    'message_id', v_message_id,
    'status', v_existing_status,
    'created_new', v_created_new
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', 'database_error');
END;
$function$;