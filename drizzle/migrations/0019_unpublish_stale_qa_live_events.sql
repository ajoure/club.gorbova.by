-- Withdraw two reviewed, unused QA fixtures. Keep records, lifecycle and ACLs.
-- Atomic CAS: an unexpected/missing/partially changed snapshot aborts both writes.
DO $$
DECLARE
  v record;
  e public.live_events%ROWTYPE;
  v_count integer;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM id FROM public.live_events
    WHERE id IN ('6ea22dad-2c60-48a3-986f-aa04efd0eab6', '4ad98360-41d5-40c2-9d3c-946d314e5875')
    ORDER BY id FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.live_events
  WHERE (id = '6ea22dad-2c60-48a3-986f-aa04efd0eab6' AND slug = 'qa-live-open')
     OR (id = '4ad98360-41d5-40c2-9d3c-946d314e5875' AND slug = 'qa-live-locked');
  IF v_count <> 2 THEN RAISE EXCEPTION 'qa_live_expected_two_identities'; END IF;

  SELECT count(*) INTO v_count FROM public.live_events
  WHERE id IN ('6ea22dad-2c60-48a3-986f-aa04efd0eab6', '4ad98360-41d5-40c2-9d3c-946d314e5875')
    AND is_published IS FALSE;
  IF v_count = 2 THEN RETURN; END IF; -- already applied, no timestamp churn
  IF v_count <> 0 THEN RAISE EXCEPTION 'qa_live_partial_snapshot'; END IF;

  FOR v IN SELECT * FROM (VALUES
    ('6ea22dad-2c60-48a3-986f-aa04efd0eab6'::uuid, '2026-07-21 15:16:34.558461+00'::timestamptz,
     '2026-07-07 16:32:14.916+00'::timestamptz),
    ('4ad98360-41d5-40c2-9d3c-946d314e5875'::uuid, '2026-07-10 13:32:00.572753+00'::timestamptz,
     '2026-07-07 16:32:15.233+00'::timestamptz)
  ) AS snapshot(id, updated_at, scheduled_at)
  LOOP
    SELECT * INTO STRICT e FROM public.live_events WHERE id = v.id;
    IF e.updated_at IS DISTINCT FROM v.updated_at OR e.scheduled_at IS DISTINCT FROM v.scheduled_at
       OR e.is_published IS DISTINCT FROM true OR e.status IS DISTINCT FROM 'scheduled'
       OR e.platform_status IS DISTINCT FROM 'draft' OR e.room_state IS DISTINCT FROM 'closed'
       OR e.source_kind IS DISTINCT FROM 'kinescope_live_event' OR e.replay_enabled IS DISTINCT FROM false
       OR e.kinescope_video_id IS NOT NULL OR e.kinescope_live_event_id IS NOT NULL
       OR e.live_started_at IS NOT NULL OR e.room_opened_at IS NOT NULL THEN
      RAISE EXCEPTION 'qa_live_snapshot_changed';
    END IF;
  END LOOP;

  -- The source helper deploy must precede this repair, so it cannot republish.
  UPDATE public.live_events SET is_published = false
    WHERE id IN ('6ea22dad-2c60-48a3-986f-aa04efd0eab6', '4ad98360-41d5-40c2-9d3c-946d314e5875')
      AND is_published IS TRUE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 THEN RAISE EXCEPTION 'qa_live_expected_two_updates'; END IF;
END $$;
