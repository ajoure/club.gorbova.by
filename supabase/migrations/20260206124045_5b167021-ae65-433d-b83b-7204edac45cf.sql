-- =============================================================================
-- edge_functions_registry: Единственный источник истины для Edge Functions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.edge_functions_registry (
  name TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'P2',
  category TEXT NOT NULL DEFAULT 'internal',
  must_exist BOOLEAN NOT NULL DEFAULT TRUE,
  healthcheck_method TEXT NOT NULL DEFAULT 'OPTIONS',
  expected_status INTEGER[] NOT NULL DEFAULT '{200,400,401,403,405}',
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  auto_fix_policy TEXT NOT NULL DEFAULT 'none',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.edge_functions_registry ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT only for superadmin
CREATE POLICY "superadmin_select_edge_functions_registry" ON public.edge_functions_registry
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles_v2 ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.code = 'superadmin'
    )
  );

-- Grant full access to service_role (for Edge Functions)
GRANT ALL ON public.edge_functions_registry TO service_role;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_edge_functions_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_edge_functions_registry_updated_at
  BEFORE UPDATE ON public.edge_functions_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.update_edge_functions_registry_updated_at();

-- =============================================================================
-- SEED DATA: Все функции из supabase/functions/ (166 записей)
-- =============================================================================

INSERT INTO public.edge_functions_registry (name, tier, category, auto_fix_policy, notes) VALUES
-- P0 TIER: Платежи и критичные бизнес-операции
('subscription-charge', 'P0', 'cron', 'restart', 'Автопродление подписок'),
('direct-charge', 'P0', 'browser', 'none', 'Прямой платёж'),
('cancel-trial', 'P0', 'browser', 'none', 'Отмена триала'),
('bepaid-webhook', 'P0', 'webhook', 'none', 'Вебхук платежей bePaid'),
('payment-methods-webhook', 'P0', 'webhook', 'none', 'Вебхук токенизации карт'),

-- P0 TIER: Telegram доступы
('telegram-process-access-queue', 'P0', 'cron', 'restart', 'Очередь Telegram доступов'),
('telegram-grant-access', 'P0', 'internal', 'none', 'Выдача Telegram доступа'),
('telegram-revoke-access', 'P0', 'internal', 'none', 'Отзыв Telegram доступа'),
('telegram-webhook', 'P0', 'webhook', 'none', 'Вебхук Telegram бота'),

-- P0 TIER: Системные
('nightly-system-health', 'P0', 'cron', 'restart', 'Ночной аудит системы'),
('nightly-payments-invariants', 'P0', 'cron', 'restart', 'Ночной аудит платежей'),
('system-health-full-check', 'P0', 'browser', 'none', 'Полный чек системы'),

-- P1 TIER: Важные интеграции
('integration-healthcheck', 'P1', 'browser', 'none', 'Хелсчек интеграций'),
('payment-method-verify-recurring', 'P1', 'browser', 'none', 'Проверка рекуррентных платежей'),
('bepaid-list-subscriptions', 'P1', 'browser', 'none', 'Список подписок bePaid'),
('bepaid-get-subscription-details', 'P1', 'browser', 'none', 'Детали подписки bePaid'),
('bepaid-create-token', 'P1', 'browser', 'none', 'Токенизация карты'),
('admin-payments-diagnostics', 'P1', 'browser', 'none', 'Диагностика платежей'),
('roles-admin', 'P1', 'browser', 'none', 'Управление ролями'),
('users-admin-actions', 'P1', 'browser', 'none', 'Админские действия над пользователями'),

-- P1 TIER: Телеграм
('telegram-admin-chat', 'P1', 'browser', 'none', 'Админский Telegram чат'),
('telegram-check-expired', 'P1', 'cron', 'restart', 'Проверка истёкших доступов'),
('telegram-club-members', 'P1', 'browser', 'none', 'Участники клуба'),
('telegram-cron-sync', 'P1', 'cron', 'restart', 'Синхронизация Telegram'),
('telegram-daily-summary', 'P1', 'cron', 'none', 'Ежедневная сводка'),
('telegram-kick-violators', 'P1', 'cron', 'none', 'Кик нарушителей'),
('telegram-link-manage', 'P1', 'browser', 'none', 'Управление ссылками'),
('telegram-mass-broadcast', 'P1', 'browser', 'none', 'Массовая рассылка'),
('telegram-notify-admins', 'P1', 'internal', 'none', 'Уведомление админов'),
('telegram-send-notification', 'P1', 'internal', 'none', 'Отправка уведомления'),
('telegram-bot-actions', 'P1', 'browser', 'none', 'Действия бота'),
('telegram-send-test', 'P1', 'browser', 'none', 'Тест отправки'),

-- P1 TIER: Email
('send-email', 'P1', 'internal', 'none', 'Отправка email'),
('email-fetch-inbox', 'P1', 'cron', 'restart', 'Получение входящих email'),
('email-mass-broadcast', 'P1', 'browser', 'none', 'Email рассылка'),
('email-test-connection', 'P1', 'browser', 'none', 'Тест email подключения'),

-- P1 TIER: Подписки
('subscription-actions', 'P1', 'browser', 'none', 'Действия с подпиской'),
('subscription-admin-actions', 'P1', 'browser', 'none', 'Админские действия с подпиской'),
('subscription-grace-reminders', 'P1', 'cron', 'restart', 'Напоминания grace period'),
('subscription-renewal-reminders', 'P1', 'cron', 'restart', 'Напоминания о продлении'),
('subscriptions-reconcile', 'P1', 'browser', 'none', 'Сверка подписок'),

-- P1 TIER: Auth
('auth-actions', 'P1', 'browser', 'none', 'Действия авторизации'),
('auth-check-email', 'P1', 'browser', 'none', 'Проверка email'),

-- P2 TIER: bePaid интеграции
('bepaid-admin-create-subscription-link', 'P2', 'browser', 'none', NULL),
('bepaid-archive-import', 'P2', 'browser', 'none', NULL),
('bepaid-auto-process', 'P2', 'cron', 'restart', NULL),
('bepaid-cancel-subscriptions', 'P2', 'browser', 'none', NULL),
('bepaid-create-subscription-checkout', 'P2', 'browser', 'none', NULL),
('bepaid-create-subscription', 'P2', 'browser', 'none', NULL),
('bepaid-discrepancy-alert', 'P2', 'cron', 'none', NULL),
('bepaid-docs-backfill', 'P2', 'admin', 'none', NULL),
('bepaid-fetch-receipt', 'P2', 'browser', 'none', NULL),
('bepaid-fetch-transactions', 'P2', 'browser', 'none', NULL),
('bepaid-get-payment-docs', 'P2', 'browser', 'none', NULL),
('bepaid-get-receipt', 'P2', 'browser', 'none', NULL),
('bepaid-polling-backfill', 'P2', 'admin', 'none', NULL),
('bepaid-process-refunds', 'P2', 'cron', 'none', NULL),
('bepaid-queue-cron', 'P2', 'cron', 'restart', NULL),
('bepaid-raw-transactions', 'P2', 'browser', 'none', NULL),
('bepaid-receipts-cron', 'P2', 'cron', 'restart', NULL),
('bepaid-receipts-sync', 'P2', 'browser', 'none', NULL),
('bepaid-reconcile-file', 'P2', 'browser', 'none', NULL),
('bepaid-recover-payment', 'P2', 'browser', 'none', NULL),
('bepaid-report-import', 'P2', 'browser', 'none', NULL),
('bepaid-subscription-audit-cron', 'P2', 'cron', 'restart', NULL),
('bepaid-subscription-audit', 'P2', 'browser', 'none', NULL),
('bepaid-sync-orchestrator', 'P2', 'cron', 'restart', NULL),
('bepaid-uid-resync', 'P2', 'admin', 'none', NULL),

-- P2 TIER: Admin функции
('admin-backfill-2026-orders', 'P2', 'admin', 'none', NULL),
('admin-backfill-bepaid-statement-dates', 'P2', 'admin', 'none', NULL),
('admin-backfill-bepaid-statement-fields', 'P2', 'admin', 'none', NULL),
('admin-backfill-recurring-snapshot', 'P2', 'admin', 'none', NULL),
('admin-batch-disable-auto-renew', 'P2', 'admin', 'none', NULL),
('admin-bepaid-emergency-unlink', 'P2', 'admin', 'none', NULL),
('admin-bepaid-full-reconcile', 'P2', 'admin', 'none', NULL),
('admin-bepaid-reconcile-amounts', 'P2', 'admin', 'none', NULL),
('admin-billing-alignment', 'P2', 'admin', 'none', NULL),
('admin-false-notifications-report', 'P2', 'admin', 'none', NULL),
('admin-fix-club-billing-dates', 'P2', 'admin', 'none', NULL),
('admin-fix-false-payments', 'P2', 'admin', 'none', NULL),
('admin-fix-payments-integrity', 'P2', 'admin', 'none', NULL),
('admin-fix-sub-orders-gc', 'P2', 'admin', 'none', NULL),
('admin-fix-uid-contract', 'P2', 'admin', 'none', NULL),
('admin-import-bepaid-statement-csv', 'P2', 'admin', 'none', NULL),
('admin-legacy-cards-report', 'P2', 'admin', 'none', NULL),
('admin-link-contact', 'P2', 'admin', 'none', NULL),
('admin-link-payment-to-order', 'P2', 'admin', 'none', NULL),
('admin-manual-charge', 'P2', 'admin', 'none', NULL),
('admin-materialize-queue-payments', 'P2', 'admin', 'none', NULL),
('admin-purge-imported-transactions', 'P2', 'admin', 'none', NULL),
('admin-purge-payments-by-uid', 'P2', 'admin', 'none', NULL),
('admin-reconcile-bepaid-legacy', 'P2', 'admin', 'none', NULL),
('admin-reconcile-processing-payments', 'P2', 'admin', 'none', NULL),
('admin-regrant-wrongly-revoked', 'P2', 'admin', 'none', NULL),
('admin-repair-mismatch-orders', 'P2', 'admin', 'none', NULL),
('admin-search-profiles', 'P2', 'admin', 'none', NULL),
('admin-unlinked-payments-report', 'P2', 'admin', 'none', NULL),

-- P2 TIER: AmoCRM
('amocrm-contacts-import', 'P2', 'admin', 'none', NULL),
('amocrm-import-rollback', 'P2', 'admin', 'none', NULL),
('amocrm-mass-import', 'P2', 'admin', 'none', NULL),
('amocrm-sync', 'P2', 'cron', 'restart', NULL),
('amocrm-webhook', 'P2', 'webhook', 'none', NULL),

-- P2 TIER: AI / Analytics
('ai-import-analyzer', 'P2', 'browser', 'none', NULL),
('analyze-all-loyalty', 'P2', 'admin', 'none', NULL),
('analyze-audience', 'P2', 'browser', 'none', NULL),
('analyze-contact-loyalty', 'P2', 'browser', 'none', NULL),
('analyze-task-priority', 'P2', 'browser', 'none', NULL),

-- P2 TIER: GetCourse
('getcourse-backfill', 'P2', 'admin', 'none', NULL),
('getcourse-cancel-deal', 'P2', 'browser', 'none', NULL),
('getcourse-content-scraper', 'P2', 'admin', 'none', NULL),
('getcourse-grant-access', 'P2', 'internal', 'none', NULL),
('getcourse-import-deals', 'P2', 'admin', 'none', NULL),
('getcourse-import-file', 'P2', 'admin', 'none', NULL),
('getcourse-sync', 'P2', 'cron', 'restart', NULL),
('getcourse-webhook', 'P2', 'webhook', 'none', NULL),

-- P2 TIER: Документы
('document-auto-generate', 'P2', 'internal', 'none', NULL),
('generate-affirmation', 'P2', 'browser', 'none', NULL),
('generate-cover', 'P2', 'browser', 'none', NULL),
('generate-document-pdf', 'P2', 'browser', 'none', NULL),
('generate-from-template', 'P2', 'browser', 'none', NULL),
('generate-invoice-act', 'P2', 'browser', 'none', NULL),
('generate-lesson-notification', 'P2', 'internal', 'none', NULL),
('generate-point-b-summary', 'P2', 'browser', 'none', NULL),

-- P2 TIER: Прочие
('backfill-payment-classification', 'P2', 'admin', 'none', NULL),
('buh-business-notify', 'P2', 'cron', 'none', NULL),
('cancel-preregistration', 'P2', 'browser', 'none', NULL),
('cleanup-demo-contacts', 'P2', 'admin', 'none', NULL),
('cleanup-telegram-orphans', 'P2', 'admin', 'none', NULL),
('course-prereg-notify', 'P2', 'cron', 'none', NULL),
('detect-duplicates', 'P2', 'admin', 'none', NULL),
('diagnose-admin-notifications', 'P2', 'admin', 'none', NULL),
('export-schema', 'P2', 'admin', 'none', NULL),
('grant-access-for-order', 'P2', 'internal', 'none', NULL),
('ilex-api', 'P2', 'browser', 'none', NULL),
('ilex-fetch', 'P2', 'cron', 'restart', NULL),
('import-telegram-history', 'P2', 'admin', 'none', NULL),
('installment-charge-cron', 'P2', 'cron', 'restart', NULL),
('installment-notifications', 'P2', 'cron', 'none', NULL),
('integration-sync', 'P2', 'cron', 'restart', NULL),
('kinescope-api', 'P2', 'browser', 'none', NULL),
('merge-clients', 'P2', 'admin', 'none', NULL),
('migrate-data-export', 'P2', 'admin', 'none', NULL),
('mns-response-generator', 'P2', 'admin', 'none', NULL),
('monitor-news', 'P2', 'cron', 'none', NULL),
('payments-autolink-by-card', 'P2', 'admin', 'none', NULL),
('payments-reconcile', 'P2', 'admin', 'none', NULL),
('preregistration-charge-cron', 'P2', 'cron', 'restart', NULL),
('public-product', 'P2', 'browser', 'none', NULL),
('reassign-demo-orders', 'P2', 'admin', 'none', NULL),
('refunds-recompute-order-status', 'P2', 'admin', 'none', NULL),
('reset-lesson-progress', 'P2', 'admin', 'none', NULL),
('scan-card-duplicates', 'P2', 'admin', 'none', NULL),
('send-invoice', 'P2', 'browser', 'none', NULL),
('send-recovery-notifications', 'P2', 'cron', 'none', NULL),
('stylize-sarcasm', 'P2', 'browser', 'none', NULL),
('sync-payments-with-statement', 'P2', 'admin', 'none', NULL),
('sync-telegram-history', 'P2', 'admin', 'none', NULL),
('unmerge-clients', 'P2', 'admin', 'none', NULL),
('payment-methods-tokenize', 'P2', 'browser', 'none', NULL),

-- P2 TIER: Telegram дополнительные
('telegram-learn-style', 'P2', 'admin', 'none', NULL),
('telegram-media-worker-cron', 'P2', 'cron', 'restart', NULL),
('telegram-media-worker', 'P2', 'internal', 'none', NULL),
('telegram-process-pending', 'P2', 'cron', 'restart', NULL),
('telegram-publish-news', 'P2', 'browser', 'none', NULL),
('telegram-send-reminders', 'P2', 'cron', 'restart', NULL),

-- P2 TIER: Тесты (можно отключить)
('test-full-trial-flow', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-getcourse-sync', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-installment-flow', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-payment-complete', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-payment-direct', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-quiz-progress-rls', 'P2', 'admin', 'none', 'Тестовая функция'),
('test-quiz-progress', 'P2', 'admin', 'none', 'Тестовая функция')

ON CONFLICT (name) DO NOTHING;