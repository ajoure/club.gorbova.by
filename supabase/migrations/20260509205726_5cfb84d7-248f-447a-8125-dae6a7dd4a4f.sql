-- C5-J: Удаляем plain-text Gotenberg password из integration_instances.config.
-- Пароль теперь живёт ТОЛЬКО в ENV GOTENBERG_PASSWORD (Supabase secrets).
UPDATE public.integration_instances
SET config = (config - 'gotenberg_basic_pass')
WHERE provider = 'hosterby'
  AND category = 'other'
  AND config ? 'gotenberg_basic_pass';