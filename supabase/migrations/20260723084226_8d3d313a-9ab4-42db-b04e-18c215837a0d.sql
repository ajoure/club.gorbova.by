-- 20260723100000_autoweb_live_phase_ends_at.sql
-- Нормализация live_event_sessions.ends_at к концу ЖИВОЙ фазы:
--   ends_at = starts_at + autoweb_config.video.duration_seconds
-- Fallback 3600 сек, если duration_seconds отсутствует/некорректен.
-- Затрагиваются ТОЛЬКО pending/live сессии событий event_type='autowebinar'
-- в режимах scheduled|just_in_time|on_demand|one_time.
-- Завершённые сессии не переписываются. Status/replay-настройки/сами события не меняются.
UPDATE public.live_event_sessions s
SET ends_at = s.starts_at
            + (COALESCE(
                 NULLIF(
                   GREATEST(0, floor((e.autoweb_config #>> '{video,duration_seconds}')::numeric)::int),
                   0
                 ),
                 3600
               ) || ' seconds')::interval,
    updated_at = now()
FROM public.live_events e
WHERE s.live_event_id = e.id
  AND e.event_type = 'autowebinar'
  AND s.status IN ('pending','live')
  AND s.mode IN ('scheduled','just_in_time','on_demand','one_time');