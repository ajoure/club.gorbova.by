
-- RPC: atomic outbox pull with requeue stale + FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.instagram_outbox_pull_v1(
  p_account_id uuid,
  p_limit int,
  p_lock_id uuid
) RETURNS SETOF public.instagram_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Step 1: requeue stale sending (lock expired > 10 min)
  WITH requeued AS (
    UPDATE instagram_messages
       SET status = 'queued',
           sending_at = NULL,
           sending_lock_id = NULL
     WHERE instagram_account_id = p_account_id
       AND status = 'sending'
       AND sending_at < now() - interval '10 minutes'
     RETURNING 1
  ),
  -- Step 2: select candidates with row-level lock
  candidates AS (
    SELECT id
      FROM instagram_messages
     WHERE instagram_account_id = p_account_id
       AND direction = 'outbound'
       AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT LEAST(GREATEST(p_limit, 1), 20)
     FOR UPDATE SKIP LOCKED
  )
  -- Step 3: atomically mark as sending
  UPDATE instagram_messages m
     SET status = 'sending',
         sending_at = now(),
         sending_lock_id = p_lock_id
    FROM candidates c
   WHERE m.id = c.id
  RETURNING m.*;
$$;
