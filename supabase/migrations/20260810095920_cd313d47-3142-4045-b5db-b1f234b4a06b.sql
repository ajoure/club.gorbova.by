-- Contact-center work ownership and reliable unanswered state.
-- This migration is intentionally production-neutral: it creates no data
-- backfill and sends no notifications by itself.

ALTER TABLE public.telegram_messages
  ADD COLUMN IF NOT EXISTS requires_reply boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.telegram_messages.requires_reply IS
  'True for an incoming client message until a human reply resolves it. It is independent from is_read.';

CREATE OR REPLACE FUNCTION public.telegram_messages_set_requires_reply()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A client message starts a work item. System/bot messages are outgoing in
  -- the canonical telegram_messages stream, therefore cannot reopen a dialog.
  IF NEW.direction = 'incoming' THEN
    NEW.requires_reply := true;
  ELSIF NEW.direction = 'outgoing' THEN
    NEW.requires_reply := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telegram_messages_set_requires_reply_before_insert ON public.telegram_messages;
CREATE TRIGGER telegram_messages_set_requires_reply_before_insert
  BEFORE INSERT ON public.telegram_messages
  FOR EACH ROW EXECUTE FUNCTION public.telegram_messages_set_requires_reply();

CREATE INDEX IF NOT EXISTS telegram_messages_open_reply_idx
  ON public.telegram_messages (user_id, transport, business_account_id, bot_id, created_at ASC)
  WHERE direction = 'incoming' AND requires_reply = true;

CREATE TABLE IF NOT EXISTS public.contact_center_message_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('telegram')),
  source_message_id uuid NOT NULL REFERENCES public.telegram_messages(id) ON DELETE CASCADE,
  assignee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_message_id uuid REFERENCES public.telegram_messages(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_center_message_assignments_one_open_idx
  ON public.contact_center_message_assignments(source_message_id)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_center_message_assignments_assignee_open_idx
  ON public.contact_center_message_assignments(assignee_user_id, assigned_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.contact_center_message_assignments ENABLE ROW LEVEL SECURITY;

-- The project has permissive table default privileges. Keep the new work queue
-- explicitly unavailable to anon and expose it only through authenticated RLS
-- (service_role remains available for the notification worker).
REVOKE ALL ON TABLE public.contact_center_message_assignments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_center_message_assignments TO authenticated;
GRANT ALL ON TABLE public.contact_center_message_assignments TO service_role;

DROP POLICY IF EXISTS "Communication viewers can view contact center assignments" ON public.contact_center_message_assignments;
CREATE POLICY "Communication viewers can view contact center assignments"
  ON public.contact_center_message_assignments FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

DROP POLICY IF EXISTS "Communication managers can manage contact center assignments" ON public.contact_center_message_assignments;
CREATE POLICY "Communication managers can manage contact center assignments"
  ON public.contact_center_message_assignments FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

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
  IF NOT (current_user = 'service_role' OR (
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
       -- Include legacy rows that predate requires_reply. They were tracked
       -- only through is_read and must also be resolved by the next human
       -- answer, otherwise historical counters remain permanently inflated.
       AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
       AND m.transport = p_transport
       AND ((p_transport = 'bot' AND m.bot_id = p_bot_id)
         OR (p_transport = 'business' AND m.business_account_id = p_business_account_id))
       AND (
         (p_boundary_message_id IS NOT NULL AND m.message_id IS NOT NULL AND m.message_id < p_boundary_message_id)
         OR (p_boundary_message_id IS NULL AND m.created_at <= p_boundary)
       )
    RETURNING m.id
  ), closed_assignments AS (
    UPDATE public.contact_center_message_assignments a
       SET resolved_at = now(),
           resolved_by_user_id = v_caller,
           resolution_message_id = p_resolution_message_id,
           updated_at = now()
     WHERE a.resolved_at IS NULL
       AND a.source = 'telegram'
       AND a.source_message_id IN (SELECT id FROM resolved)
    RETURNING a.id
  )
  SELECT count(*)::int INTO v_marked FROM resolved;

  SELECT count(*)::int INTO v_remaining
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

REVOKE ALL ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_contact_center_unanswered_v1(p_user_id uuid)
RETURNS TABLE(id uuid, message_text text, created_at timestamptz, transport text, bot_id uuid, business_account_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.message_text, m.created_at, m.transport, m.bot_id, m.business_account_id
  FROM public.telegram_messages m
  WHERE m.user_id = p_user_id
    AND m.direction = 'incoming'
    AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
    AND public.has_admin_section_access(auth.uid(), 'communication', 'view')
  ORDER BY m.created_at ASC, m.id ASC
  LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_contact_center_unanswered_dialogs_v1()
RETURNS TABLE(user_id uuid, unanswered_count bigint, oldest_message_id uuid, oldest_message_text text, oldest_message_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_messages AS (
    SELECT m.id, m.user_id, m.message_text, m.created_at,
           row_number() OVER (PARTITION BY m.user_id ORDER BY m.created_at ASC, m.id ASC) AS rn
      FROM public.telegram_messages m
     WHERE m.direction = 'incoming'
       AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
       AND public.has_admin_section_access(auth.uid(), 'communication', 'view')
  )
  SELECT totals.user_id, totals.unanswered_count,
         first.id AS oldest_message_id, first.message_text AS oldest_message_text,
         first.created_at AS oldest_message_at
    FROM (
      SELECT user_id, count(*)::bigint AS unanswered_count
        FROM open_messages GROUP BY user_id
    ) totals
    JOIN open_messages first ON first.user_id = totals.user_id AND first.rn = 1;
$$;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_dialogs_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_dialogs_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_contact_center_unanswered_total_v1()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Верхний бейдж показывает число диалогов, требующих реакции, а не сумму
  -- всех старых входящих реплик внутри этих диалогов.
  SELECT count(DISTINCT m.user_id)::bigint
    FROM public.telegram_messages m
   WHERE m.direction = 'incoming'
     AND (m.requires_reply OR (m.requires_reply = false AND m.is_read = false))
     AND public.has_admin_section_access(auth.uid(), 'communication', 'view');
$$;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_total_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_total_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_contact_center_message_v1(
  p_message_id uuid,
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
  v_assignment_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_admin_section_access(v_actor, 'communication', 'manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.telegram_messages m
     WHERE m.id = p_message_id AND m.direction = 'incoming'
  ) THEN
    RAISE EXCEPTION 'incoming_message_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_assignee_user_id) THEN
    RAISE EXCEPTION 'assignee_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_center_message_assignments(
    source, source_message_id, assignee_user_id, assigned_by_user_id, note
  ) VALUES ('telegram', p_message_id, p_assignee_user_id, v_actor, NULLIF(btrim(p_note), ''))
  ON CONFLICT (source_message_id) WHERE resolved_at IS NULL
  DO UPDATE SET assignee_user_id = EXCLUDED.assignee_user_id,
                assigned_by_user_id = EXCLUDED.assigned_by_user_id,
                assigned_at = now(), note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO v_assignment_id;
  RETURN v_assignment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_contact_center_message_v1(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_contact_center_message_v1(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_contact_center_assignments_v1()
RETURNS TABLE(
  id uuid, source_message_id uuid, telegram_user_id uuid, assignee_user_id uuid,
  assignee_name text, assigned_at timestamptz, note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.source_message_id, m.user_id, a.assignee_user_id,
         COALESCE(p.full_name, p.email, 'Сотрудник'), a.assigned_at, a.note
  FROM public.contact_center_message_assignments a
  JOIN public.telegram_messages m ON m.id = a.source_message_id
  LEFT JOIN public.profiles p ON p.user_id = a.assignee_user_id
  WHERE a.resolved_at IS NULL
    AND public.has_admin_section_access(auth.uid(), 'communication', 'view')
  ORDER BY a.assigned_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_contact_center_assignments_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_center_assignments_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_contact_center_assignees_v1()
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.user_id, COALESCE(p.full_name, p.email, 'Сотрудник')
  FROM public.profiles p
  WHERE p.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.user_id
        -- These are the canonical production role codes. Do not translate
        -- them to English aliases: manager/employee do not exist here.
        AND r.code IN ('super_admin', 'admin', 'menedzher', 'support')
    )
    AND public.has_admin_section_access(auth.uid(), 'communication', 'view')
  ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.get_contact_center_assignees_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_center_assignees_v1() TO authenticated;

COMMENT ON TABLE public.contact_center_message_assignments IS
  'One active responsible manager for a specific unresolved Telegram customer message.';