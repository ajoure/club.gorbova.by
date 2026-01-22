-- Пересоздать cron jobs с правильным синтаксисом
-- PATCH 1A: Фикс cron jobs - добавить AS request_id; как в работающих jobs

-- Удаляем старые (не работающие)
SELECT cron.unschedule('subscription-charge-morning');
SELECT cron.unschedule('subscription-charge-evening');
SELECT cron.unschedule('subscription-renewal-reminders');

-- Создаём заново с правильным синтаксисом
SELECT cron.schedule(
  'subscription-charge-morning',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-charge',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"source": "cron-morning", "mode": "execute"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'subscription-charge-evening',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-charge',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"source": "cron-evening", "mode": "execute"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'subscription-renewal-reminders',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-renewal-reminders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  ) AS request_id;
  $$
);