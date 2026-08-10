-- Contact center read/assignment consistency.
-- Explicitly dismissing a Telegram dialog closes the same canonical work
-- item used by the unified inbox. Assignment selects that work item atomically.

CREATE OR REPLACE FUNCTION public.mark_dialog_read_v2(
  p_user_id uuid,
  p_boundary timestamptz
)
RETURNS TABLE(
  dialog_user_id uuid,
  boundary timestamptz,
  marked_count integer,
  remaining_unread_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_marked integer := 0;
  v_remain integer := 0;
  v_max_skew interval := interval '60 seconds';
BEGIN
  IF NOT (auth.role() = 'service_role' OR (
    v_caller IS NOT NULL AND public.has_admin_section_access(v_caller, 'communication', 'manage')
  )) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_boundary IS NULL THEN
    RAISE EXCEPTION 'boundary_required' USING ERRCODE = '22023';
  END IF;
  IF p_boundary > now() + v_max_skew THEN
    RAISE EXCEPTION 'boundary_in_future' USING ERRCODE = '22023';
  END IF;

  WITH resolved AS (
    UPDATE public.telegram_messages m
       SET is_read = true,
           requires_reply = false
     WHERE m.user_id = p_user_id
       AND m.direction = 'incoming'
       AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
       AND m.created_at <= p_boundary
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_marked FROM resolved;

  SELECT count(*)::integer INTO v_remain
    FROM public.telegram_messages m
   WHERE m.user_id = p_user_id
     AND m.direction = 'incoming'
     AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false));

  RETURN QUERY SELECT p_user_id, p_boundary, v_marked, v_remain;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dialog_read_v2(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_dialog_read_v2(uuid, timestamptz) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.bulk_mark_dialogs_read_v2(p_items jsonb)
RETURNS TABLE(
  dialog_user_id uuid,
  boundary timestamptz,
  marked_count integer,
  remaining_unread_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
  v_max_skew interval := interval '60 seconds';
  v_batch_max integer := 500;
  rec record;
  v_marked integer;
  v_remain integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR (
    v_caller IS NOT NULL AND public.has_admin_section_access(v_caller, 'communication', 'manage')
  )) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items_must_be_array' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count = 0 THEN
    RETURN;
  END IF;
  IF v_count > v_batch_max THEN
    RAISE EXCEPTION 'batch_too_large' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) elt
     WHERE jsonb_typeof(elt) <> 'object'
        OR (elt->>'user_id') IS NULL
        OR (elt->>'boundary') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_item_shape' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_items) AS x(user_id uuid, boundary timestamptz)
     WHERE x.user_id IS NULL
        OR x.boundary IS NULL
        OR x.boundary > now() + v_max_skew
  ) THEN
    RAISE EXCEPTION 'invalid_item_value' USING ERRCODE = '22023';
  END IF;

  FOR rec IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.boundary
      FROM jsonb_to_recordset(p_items) AS x(user_id uuid, boundary timestamptz)
     ORDER BY x.user_id, x.boundary DESC
  LOOP
    WITH resolved AS (
      UPDATE public.telegram_messages m
         SET is_read = true,
             requires_reply = false
       WHERE m.user_id = rec.user_id
         AND m.direction = 'incoming'
         AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
         AND m.created_at <= rec.boundary
      RETURNING m.id
    )
    SELECT count(*)::integer INTO v_marked FROM resolved;

    SELECT count(*)::integer INTO v_remain
      FROM public.telegram_messages m
     WHERE m.user_id = rec.user_id
       AND m.direction = 'incoming'
       AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false));

    dialog_user_id := rec.user_id;
    boundary := rec.boundary;
    marked_count := v_marked;
    remaining_unread_count := v_remain;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_mark_dialogs_read_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_mark_dialogs_read_v2(jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.assign_contact_center_dialog_v2(
  p_user_id uuid,
  p_assignee_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_message_id uuid;
  v_assignment_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_admin_section_access(v_actor, 'communication', 'manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_assignee_user_id) THEN
    RAISE EXCEPTION 'assignee_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT m.id
    INTO v_message_id
    FROM public.telegram_messages m
   WHERE m.user_id = p_user_id
     AND m.direction = 'incoming'
     AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
   ORDER BY m.created_at ASC, m.id ASC
   LIMIT 1
   FOR UPDATE;

  IF v_message_id IS NULL THEN
    RAISE EXCEPTION 'unanswered_message_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_center_message_assignments(
    source, source_message_id, assignee_user_id, assigned_by_user_id, note
  ) VALUES (
    'telegram', v_message_id, p_assignee_user_id, v_actor, NULLIF(btrim(p_note), '')
  )
  ON CONFLICT (source_message_id) WHERE resolved_at IS NULL
  DO UPDATE SET assignee_user_id = EXCLUDED.assignee_user_id,
                assigned_by_user_id = EXCLUDED.assigned_by_user_id,
                assigned_at = now(),
                note = EXCLUDED.note,
                updated_at = now()
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_contact_center_dialog_v2(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_contact_center_dialog_v2(uuid, uuid, text) TO authenticated;


-- A human reply closes the question, but intentionally keeps the assignment
-- in «Мои». The assignee removes it explicitly after the follow-up is done.
CREATE OR REPLACE FUNCTION public.resolve_telegram_conversation_v1(
  p_user_id uuid,
  p_boundary timestamptz,
  p_transport text,
  p_bot_id uuid DEFAULT NULL,
  p_business_account_id uuid DEFAULT NULL,
  p_resolution_message_id uuid DEFAULT NULL,
  p_boundary_message_id bigint DEFAULT NULL
)
RETURNS TABLE(marked_count integer, remaining_unanswered_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_marked integer := 0;
  v_remaining integer := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR (
    v_caller IS NOT NULL AND public.has_admin_section_access(v_caller, 'communication', 'manage')
  )) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_boundary IS NULL OR p_transport NOT IN ('bot', 'business') THEN
    RAISE EXCEPTION 'invalid_resolution_scope' USING ERRCODE = '22023';
  END IF;
  IF (p_transport = 'bot' AND p_bot_id IS NULL) OR
     (p_transport = 'business' AND p_business_account_id IS NULL) THEN
    RAISE EXCEPTION 'sender_scope_required' USING ERRCODE = '22023';
  END IF;

  WITH resolved AS (
    UPDATE public.telegram_messages m
       SET is_read = true,
           requires_reply = false
     WHERE m.user_id = p_user_id
       AND m.direction = 'incoming'
       AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
       AND m.transport = p_transport
       AND ((p_transport = 'bot' AND m.bot_id = p_bot_id)
         OR (p_transport = 'business' AND m.business_account_id = p_business_account_id))
       AND (
         (p_boundary_message_id IS NOT NULL AND m.message_id IS NOT NULL AND m.message_id < p_boundary_message_id)
         OR (p_boundary_message_id IS NULL AND m.created_at <= p_boundary)
       )
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_marked FROM resolved;

  SELECT count(*)::integer INTO v_remaining
    FROM public.telegram_messages m
   WHERE m.user_id = p_user_id
     AND m.direction = 'incoming'
     AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
     AND m.transport = p_transport
     AND ((p_transport = 'bot' AND m.bot_id = p_bot_id)
       OR (p_transport = 'business' AND m.business_account_id = p_business_account_id));

  RETURN QUERY SELECT v_marked, v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_contact_center_assignments_v2()
RETURNS TABLE(
  id uuid,
  source_message_id uuid,
  telegram_user_id uuid,
  assignee_user_id uuid,
  assignee_name text,
  assigned_at timestamptz,
  note text,
  is_answered boolean,
  source_message_text text,
  source_message_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         a.source_message_id,
         m.user_id,
         a.assignee_user_id,
         COALESCE(p.full_name, p.email, 'Сотрудник'),
         a.assigned_at,
         a.note,
         NOT EXISTS (
           SELECT 1
             FROM public.telegram_messages open_message
            WHERE open_message.user_id = m.user_id
              AND open_message.direction = 'incoming'
              AND (open_message.requires_reply OR (open_message.requires_reply = false AND open_message.is_read = false))
              AND open_message.transport = m.transport
              AND ((m.transport = 'bot' AND open_message.bot_id = m.bot_id)
                OR (m.transport = 'business' AND open_message.business_account_id = m.business_account_id))
         ) AS is_answered,
         m.message_text,
         m.created_at
    FROM public.contact_center_message_assignments a
    JOIN public.telegram_messages m ON m.id = a.source_message_id
    LEFT JOIN public.profiles p ON p.user_id = a.assignee_user_id
   WHERE a.resolved_at IS NULL
     AND public.has_admin_section_access(auth.uid(), 'communication', 'view')
   ORDER BY a.assigned_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_contact_center_assignments_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_center_assignments_v2() TO authenticated;


CREATE OR REPLACE FUNCTION public.unassign_contact_center_dialog_v1(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_assignee uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT a.assignee_user_id
    INTO v_assignee
    FROM public.contact_center_message_assignments a
   WHERE a.id = p_assignment_id
     AND a.resolved_at IS NULL
   FOR UPDATE;

  IF v_assignee IS NULL THEN
    RETURN false;
  END IF;
  IF v_actor <> v_assignee
     AND NOT public.has_admin_section_access(v_actor, 'communication', 'manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.contact_center_message_assignments
     SET resolved_at = now(),
         resolved_by_user_id = v_actor,
         updated_at = now()
   WHERE id = p_assignment_id
     AND resolved_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_contact_center_dialog_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_contact_center_dialog_v1(uuid) TO authenticated;
