-- `live_event_sessions.ends_at` is the end of the live phase, not the end of
-- its optional replay window.  The runtime derives replay_opens_at and
-- replay_ends_at from live_events.autoweb_config.
--
-- Older generators included replay delay/window in ends_at.  Correct only
-- sessions which may still affect lifecycle and launch deduplication; keep
-- completed records immutable for historical reporting.
WITH active_autoweb_sessions AS (
  SELECT
    s.id,
    s.starts_at
      + (
          CASE
            WHEN COALESCE(e.autoweb_config #>> '{video,duration_seconds}', '')
              ~ '^[0-9]+([.][0-9]+)?$'
              THEN (e.autoweb_config #>> '{video,duration_seconds}')::numeric
            ELSE 3600
          END
        ) * interval '1 second' AS live_ends_at
  FROM public.live_event_sessions AS s
  JOIN public.live_events AS e ON e.id = s.live_event_id
  WHERE e.event_type = 'autowebinar'
    AND s.mode IN ('scheduled', 'just_in_time', 'on_demand', 'one_time')
    AND s.status IN ('pending', 'live')
)
UPDATE public.live_event_sessions AS s
SET ends_at = a.live_ends_at,
    updated_at = now()
FROM active_autoweb_sessions AS a
WHERE s.id = a.id
  AND s.ends_at IS DISTINCT FROM a.live_ends_at;
