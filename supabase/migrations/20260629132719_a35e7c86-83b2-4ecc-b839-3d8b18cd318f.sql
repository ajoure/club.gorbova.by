
-- Unschedule prior job if exists, then schedule fresh
DO $$
BEGIN
  PERFORM cron.unschedule('crm-tasks-notify-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'crm-tasks-notify-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/crm-task-notify-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $$
);
