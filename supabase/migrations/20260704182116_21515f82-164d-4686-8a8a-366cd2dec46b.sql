
DO $$
DECLARE
  v_profile_id uuid := '3c148831-133a-4dad-b978-06cd46b0ea20';
  v_target uuid := 'b83a5c97-1538-4789-a631-467b48145d1f'; -- TKT-26-26173
  v_sources uuid[] := ARRAY[
    '50fe1d8f-fd5a-47e2-b9de-f6414085ee56', -- TKT-26-26177
    '9e51d8d7-0e05-46eb-b961-e4e4a98c283e', -- TKT-26-26179
    '799f1ce4-90b8-4d8e-808d-c2df2fa95062'  -- TKT-26-26180
  ]::uuid[];
  v_all uuid[] := v_target || v_sources;
  v_count int;
  v_msg_count int;
  v_summary text;
BEGIN
  -- safety-check 1: все 4 тикета существуют и принадлежат одному profile_id
  SELECT count(*) INTO v_count
  FROM public.support_tickets
  WHERE id = ANY(v_all) AND profile_id = v_profile_id;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'safety-check failed: expected 4 tickets for profile %, got %', v_profile_id, v_count;
  END IF;

  -- safety-check 2: все 4 в active статусе (не closed/resolved)
  SELECT count(*) INTO v_count
  FROM public.support_tickets
  WHERE id = ANY(v_all) AND status IN ('closed','resolved');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'safety-check failed: % tickets already closed/resolved', v_count;
  END IF;

  -- safety-check 3: merged_into_ticket_id IS NULL у всех 4
  SELECT count(*) INTO v_count
  FROM public.support_tickets
  WHERE id = ANY(v_all) AND merged_into_ticket_id IS NOT NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'safety-check failed: % tickets already merged', v_count;
  END IF;

  -- safety-check 4: source count = 3
  IF array_length(v_sources, 1) <> 3 THEN
    RAISE EXCEPTION 'safety-check failed: expected 3 sources, got %', array_length(v_sources, 1);
  END IF;

  -- Advisory lock на profile
  PERFORM pg_advisory_xact_lock(hashtext(v_profile_id::text));

  -- Считаем сообщения источников до переноса
  SELECT count(*) INTO v_msg_count
  FROM public.ticket_messages
  WHERE ticket_id = ANY(v_sources);

  -- Перенос сообщений в target
  UPDATE public.ticket_messages
  SET ticket_id = v_target
  WHERE ticket_id = ANY(v_sources);

  -- Перенос attachments (на всякий случай, даже если 0)
  UPDATE public.ticket_attachments
  SET ticket_id = v_target
  WHERE ticket_id = ANY(v_sources);

  -- Системное summary в target
  v_summary := format(
    'Системное сообщение: в это обращение объединены %s ранее созданных обращений (TKT-26-26177, TKT-26-26179, TKT-26-26180). Перенесено сообщений: %s.',
    array_length(v_sources, 1), v_msg_count
  );

  INSERT INTO public.ticket_messages (ticket_id, author_id, author_type, author_name, message, is_internal, is_read)
  VALUES (v_target, NULL, 'system', 'Система', v_summary, false, true);

  -- Закрытие sources с пометкой merged
  UPDATE public.support_tickets
  SET status = 'closed',
      merged_into_ticket_id = v_target,
      merged_at = now(),
      closed_at = COALESCE(closed_at, now()),
      updated_at = now()
  WHERE id = ANY(v_sources);

  -- Обновление target
  UPDATE public.support_tickets
  SET updated_at = now(),
      has_unread_admin = true
  WHERE id = v_target;

  RAISE NOTICE 'Merge complete: target=%, sources=%, messages_moved=%', v_target, array_length(v_sources,1), v_msg_count;
END $$;
