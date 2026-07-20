-- Close only stale autoweb sessions when no browser heartbeat ever arrives.
-- This is intentionally a terminal-only repair: it cannot start or alter an
-- active session and is safe to run repeatedly from pg_cron.

CREATE OR REPLACE FUNCTION public.close_stale_autoweb_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _closed integer := 0;
BEGIN
  WITH candidates AS (
    SELECT id, live_event_id, metadata
      FROM public.live_event_sessions
     WHERE status IN ('pending', 'live')
       AND ends_at < now() - interval '5 minutes'
       AND metadata->>'auto_ended_at' IS NULL
       -- Heartbeats are written by our Edge function in ISO-8601 form. Treat
       -- absent or malformed historic values as stale rather than allowing an
       -- old terminal session to live forever.
       AND (
         metadata->>'last_heartbeat_at' IS NULL
         OR metadata->>'last_heartbeat_at' !~
           '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})$'
         OR (metadata->>'last_heartbeat_at')::timestamptz < now() - interval '15 minutes'
       )
     FOR UPDATE SKIP LOCKED
  ), healed AS (
    UPDATE public.live_event_sessions s
       SET status = 'ended',
           metadata = s.metadata || jsonb_build_object(
             'auto_ended_at', now()::text,
             'auto_end_reason', 'server_self_heal'
           ),
           updated_at = now()
      FROM candidates c
     WHERE s.id = c.id
       AND s.status IN ('pending', 'live')
       AND s.metadata->>'auto_ended_at' IS NULL
    RETURNING s.id, s.live_event_id
  )
  , logged AS (
    INSERT INTO public.audit_logs(action, entity_type, entity_id, actor_type, meta)
    SELECT 'autoweb.session.self_healed', 'live_event_session', id, 'system',
      jsonb_build_object('reason', 'server_self_heal')
    FROM healed
    RETURNING id
  )
  SELECT count(*) INTO _closed
  FROM healed;

  RETURN _closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_autoweb_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_stale_autoweb_sessions() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autoweb-stale-session-self-heal') THEN
    PERFORM cron.unschedule('autoweb-stale-session-self-heal');
  END IF;
END $$;

SELECT cron.schedule(
  'autoweb-stale-session-self-heal',
  '*/5 * * * *',
  'SELECT public.close_stale_autoweb_sessions();'
);
