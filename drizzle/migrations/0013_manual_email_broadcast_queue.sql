-- Technical payload queue for NEW manual email sends. Canonical recipient and
-- outcome evidence remain broadcast_deliveries. Existing queued deliveries are
-- deliberately not backfilled, so deploying this cannot resend old campaigns.
CREATE TABLE public.broadcast_email_queue (
  delivery_id uuid PRIMARY KEY REFERENCES public.broadcast_deliveries(id),
  account_id uuid NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','accepted','failed','uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_code text
);
ALTER TABLE public.broadcast_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broadcast_email_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.broadcast_email_queue TO service_role;
CREATE INDEX broadcast_email_queue_due_idx ON public.broadcast_email_queue(account_id,next_attempt_at) WHERE status='queued';

CREATE TABLE public.broadcast_email_queue_gate (
  account_id uuid PRIMARY KEY,
  next_batch_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.broadcast_email_queue_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broadcast_email_queue_gate FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.broadcast_email_queue_gate TO service_role;

CREATE FUNCTION public.claim_manual_broadcast_emails(_account_id uuid)
RETURNS SETOF public.broadcast_email_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('broadcast-email:' || _account_id::text,0)) THEN RETURN; END IF;
  -- Acceptance survives a failed final queue update; such jobs never resend.
  UPDATE public.broadcast_email_queue q SET status='accepted',updated_at=now()
    FROM public.broadcast_deliveries d WHERE d.id=q.delivery_id AND q.account_id=_account_id
      AND q.status='processing' AND d.accepted_at IS NOT NULL;
  -- A dead worker can no longer block future campaigns, but its uncertain
  -- recipients remain quarantined rather than being retried automatically.
  UPDATE public.broadcast_email_queue SET status='uncertain',error_code='smtp_outcome_unknown',updated_at=now()
    WHERE account_id=_account_id AND status='processing' AND updated_at<now()-interval '10 minutes';
  -- A lost worker has an unknown SMTP outcome. Never automatically reclaim it.
  IF EXISTS (SELECT 1 FROM public.broadcast_email_queue WHERE account_id=_account_id AND status='processing') THEN RETURN; END IF;
  INSERT INTO public.broadcast_email_queue_gate(account_id) VALUES (_account_id) ON CONFLICT DO NOTHING;
  IF EXISTS (SELECT 1 FROM public.broadcast_email_queue_gate WHERE account_id=_account_id AND next_batch_at>now()) THEN RETURN; END IF;
  UPDATE public.broadcast_email_queue_gate SET next_batch_at=now()+interval '1 minute' WHERE account_id=_account_id;
  RETURN QUERY
    WITH picked AS (
      SELECT q.delivery_id FROM public.broadcast_email_queue q
      JOIN public.broadcast_deliveries d ON d.id=q.delivery_id
      WHERE q.account_id=_account_id AND q.status='queued' AND q.next_attempt_at<=now()
        AND d.channel='email' AND d.status='queued' AND d.accepted_at IS NULL
      ORDER BY q.next_attempt_at,q.delivery_id LIMIT 10 FOR UPDATE OF q SKIP LOCKED
    )
    UPDATE public.broadcast_email_queue q SET status='processing',attempts=q.attempts+1,updated_at=now()
    FROM picked WHERE q.delivery_id=picked.delivery_id RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_manual_broadcast_emails(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_broadcast_emails(uuid) TO service_role;

-- Insert one whole audience transactionally: failed preparation cannot leave a
-- partially enqueued campaign that sends while the UI reports an error.
CREATE FUNCTION public.enqueue_manual_broadcast_emails(_jobs jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF jsonb_typeof(_jobs)<>'array' OR jsonb_array_length(_jobs)>10000 THEN RAISE EXCEPTION 'invalid_email_queue_jobs'; END IF;
  INSERT INTO public.broadcast_email_queue(delivery_id,account_id,recipient,subject,html)
    SELECT j.delivery_id,j.account_id,j.recipient,j.subject,j.html
    FROM jsonb_to_recordset(_jobs) AS j(delivery_id uuid,account_id uuid,recipient text,subject text,html text)
    JOIN public.broadcast_deliveries d ON d.id=j.delivery_id
    WHERE d.channel='email' AND d.status='queued' AND d.accepted_at IS NULL
    ON CONFLICT (delivery_id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_manual_broadcast_emails(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_manual_broadcast_emails(jsonb) TO service_role;
