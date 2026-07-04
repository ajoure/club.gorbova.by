
-- 1. Add merge tracking columns
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id uuid
    REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

COMMENT ON COLUMN public.support_tickets.merged_into_ticket_id IS
  'Если тикет был объединён в другой (dedup active tickets per profile), ссылка на target ticket. NULL для обычных тикетов.';
COMMENT ON COLUMN public.support_tickets.merged_at IS
  'Момент объединения тикета в target (см. merged_into_ticket_id).';

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_support_tickets_merged_into
  ON public.support_tickets (merged_into_ticket_id)
  WHERE merged_into_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_active_by_profile
  ON public.support_tickets (profile_id, updated_at DESC)
  WHERE status IN ('open','in_progress','waiting_user')
    AND merged_into_ticket_id IS NULL;

-- 3. RPC для admin-triggered merge (не используется backfill'ом — тот идёт напрямую SQL)
CREATE OR REPLACE FUNCTION public.admin_merge_support_tickets(
  p_target_ticket_id uuid,
  p_source_ticket_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target support_tickets%ROWTYPE;
  v_source_count int;
  v_moved_messages int;
  v_source_numbers text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT (public.has_permission(v_caller, 'support.manage')
          OR public.has_permission(v_caller, 'admins.manage')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_target_ticket_id IS NULL OR p_source_ticket_ids IS NULL OR array_length(p_source_ticket_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  IF p_target_ticket_id = ANY(p_source_ticket_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_in_sources');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_target_ticket_id::text));

  SELECT * INTO v_target FROM public.support_tickets WHERE id = p_target_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_not_found');
  END IF;

  IF v_target.merged_into_ticket_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_already_merged');
  END IF;

  -- Source tickets must belong to same profile and be still active
  IF EXISTS (
    SELECT 1 FROM public.support_tickets s
    WHERE s.id = ANY(p_source_ticket_ids)
      AND (s.profile_id IS DISTINCT FROM v_target.profile_id
           OR s.status NOT IN ('open','in_progress','waiting_user')
           OR s.merged_into_ticket_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'source_mismatch_or_closed');
  END IF;

  SELECT array_to_string(array_agg(ticket_number ORDER BY created_at), ', ')
    INTO v_source_numbers
  FROM public.support_tickets WHERE id = ANY(p_source_ticket_ids);

  -- Move messages
  WITH moved AS (
    UPDATE public.ticket_messages
       SET ticket_id = p_target_ticket_id
     WHERE ticket_id = ANY(p_source_ticket_ids)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_moved_messages FROM moved;

  -- Close sources
  UPDATE public.support_tickets
     SET status = 'closed',
         merged_into_ticket_id = p_target_ticket_id,
         merged_at = now(),
         closed_at = now(),
         updated_at = now()
   WHERE id = ANY(p_source_ticket_ids);

  GET DIAGNOSTICS v_source_count = ROW_COUNT;

  -- Insert system summary message in target
  INSERT INTO public.ticket_messages (ticket_id, author_id, author_type, author_name, message, is_internal)
  VALUES (
    p_target_ticket_id,
    v_caller,
    'system',
    'Система',
    format('Объединено %s обращени%s: %s',
           v_source_count,
           CASE WHEN v_source_count = 1 THEN 'е'
                WHEN v_source_count BETWEEN 2 AND 4 THEN 'я'
                ELSE 'й' END,
           v_source_numbers),
    false
  );

  -- Refresh target activity
  UPDATE public.support_tickets
     SET has_unread_admin = true,
         status = CASE WHEN status = 'waiting_user' THEN 'open' ELSE status END,
         updated_at = now()
   WHERE id = p_target_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'target_ticket_id', p_target_ticket_id,
    'merged_count', v_source_count,
    'moved_messages', v_moved_messages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merge_support_tickets(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_merge_support_tickets(uuid, uuid[]) TO authenticated;
