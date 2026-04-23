-- PATCH MIT-OFF (2026-04-23): деактивировать cron, который дёргает payment-method-verify-recurring (источник 401 spam).
-- Сама функция уже возвращает 410 Gone (см. supabase/functions/payment-method-verify-recurring/index.ts).
-- Cron оставляем в БД (не unschedule), чтобы сохранить аудит-след; просто выключаем active=false.
SELECT cron.alter_job(job_id := 21, active := false);

-- Аудит факта вывода MIT runtime path из эксплуатации
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
VALUES (
  'mit.runtime_disabled.cron_deactivated',
  'system',
  'migration:mit-off-2026-04-23',
  jsonb_build_object(
    'cron_jobid', 21,
    'cron_jobname', 'verify-recurring-cards',
    'reason', 'MIT runtime retired. Auto-renewal handled exclusively by bePaid SBS (provider_managed).',
    'edge_functions_disabled', jsonb_build_array('payment-method-verify-recurring', 'direct-charge'),
    'subscription_charge_mit_skip', 'already enforced by PATCH RENEWAL+PAYMENTS.1 A2'
  )
);