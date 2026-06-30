
-- Ускоряем поллер VOCHI с 60s до 15s: оставляем тик в минуту, плюс добавляем три тика со смещением 15/30/45s через pg_sleep.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('vochi-calls-poll-tick-15','vochi-calls-poll-tick-30','vochi-calls-poll-tick-45');
END $$;

SELECT cron.schedule(
  'vochi-calls-poll-tick-15',
  '* * * * *',
  $cron$
  SELECT pg_sleep(15);
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/vochi-calls-poll',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT cron.schedule(
  'vochi-calls-poll-tick-30',
  '* * * * *',
  $cron$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/vochi-calls-poll',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT cron.schedule(
  'vochi-calls-poll-tick-45',
  '* * * * *',
  $cron$
  SELECT pg_sleep(45);
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/vochi-calls-poll',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $cron$
);
