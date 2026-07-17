CREATE OR REPLACE FUNCTION public.claim_notification_outbox_slot(
  p_user_id uuid,
  p_channel text,
  p_message_type text,
  p_idempotency_key text,
  p_source text DEFAULT 'subscription-renewal-reminders',
  p_meta jsonb DEFAULT '{}'::jsonb,
  p_stale_after interval DEFAULT '15 minutes'
)
RETURNS TABLE(
  claimed boolean,
  outbox_id uuid,
  outbox_status text,
  reason text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.notification_outbox%ROWTYPE;
  v_claimed public.notification_outbox%ROWTYPE;
BEGIN
  LOOP
    INSERT INTO public.notification_outbox (
      user_id,
      channel,
      message_type,
      idempotency_key,
      source,
      status,
      meta,
      attempt_count,
      last_attempt_at,
      blocked_reason
    ) VALUES (
      p_user_id,
      p_channel,
      p_message_type,
      p_idempotency_key,
      COALESCE(p_source, 'subscription-renewal-reminders'),
      'sending',
      COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('leased_at', now()),
      1,
      now(),
      NULL
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING * INTO v_claimed;

    IF FOUND THEN
      RETURN QUERY SELECT true, v_claimed.id, v_claimed.status, 'inserted', COALESCE(v_claimed.attempt_count, 1);
      RETURN;
    END IF;

    SELECT * INTO v_existing
    FROM public.notification_outbox
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_existing.status = 'sent' THEN
      RETURN QUERY SELECT false, v_existing.id, v_existing.status, 'already_sent', COALESCE(v_existing.attempt_count, 1);
      RETURN;
    END IF;

    IF v_existing.status IN ('failed', 'blocked')
       OR (
         v_existing.status IN ('sending', 'queued')
         AND COALESCE(v_existing.last_attempt_at, v_existing.created_at) < now() - p_stale_after
       ) THEN
      UPDATE public.notification_outbox
      SET
        status = 'sending',
        attempt_count = COALESCE(v_existing.attempt_count, 1) + 1,
        last_attempt_at = now(),
        blocked_reason = NULL,
        meta = COALESCE(v_existing.meta, '{}'::jsonb)
          || COALESCE(p_meta, '{}'::jsonb)
          || jsonb_build_object(
            'leased_at', now(),
            'reclaimed_from_status', v_existing.status,
            'reclaimed_at', now()
          )
      WHERE id = v_existing.id
      RETURNING * INTO v_claimed;

      RETURN QUERY SELECT true, v_claimed.id, v_claimed.status, 'reclaimed', COALESCE(v_claimed.attempt_count, 1);
      RETURN;
    END IF;

    RETURN QUERY SELECT false, v_existing.id, v_existing.status, 'in_progress', COALESCE(v_existing.attempt_count, 1);
    RETURN;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval) TO service_role;

COMMENT ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval)
IS 'Atomic notification outbox lease/reclaim for idempotent reminder delivery.';