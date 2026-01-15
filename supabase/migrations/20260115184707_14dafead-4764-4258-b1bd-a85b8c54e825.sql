-- PATCH 1 & 3: Добавляем поля для настроек синка и retry logic

-- Добавляем поля в integration_instances для bePaid настроек синка
-- Эти поля будут храниться в JSONB config

-- Добавляем поле last_successful_sync_at для watermark в integration_instances
ALTER TABLE public.integration_instances 
ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamp with time zone;

-- Добавляем поля retry logic в payment_reconcile_queue (некоторые уже есть, но добавим недостающие)
ALTER TABLE public.payment_reconcile_queue 
ADD COLUMN IF NOT EXISTS last_attempt_at timestamp with time zone;

-- Обновляем индексы для дедупликации
-- Убедимся что индекс по bepaid_uid уникальный для всех статусов
DROP INDEX IF EXISTS idx_payment_reconcile_queue_bepaid_uid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_queue_bepaid_uid_unique 
ON public.payment_reconcile_queue (bepaid_uid) 
WHERE bepaid_uid IS NOT NULL;

-- Индекс для retry logic
CREATE INDEX IF NOT EXISTS idx_payment_queue_next_retry 
ON public.payment_reconcile_queue (next_retry_at, status, attempts) 
WHERE status IN ('pending', 'error');

-- Индекс для быстрого поиска по статусу и попыткам
CREATE INDEX IF NOT EXISTS idx_payment_queue_status_attempts 
ON public.payment_reconcile_queue (status, attempts, created_at);

-- Таблица для логирования синхронизации bePaid (для аудита)
CREATE TABLE IF NOT EXISTS public.bepaid_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL DEFAULT 'fetch_transactions', -- 'fetch_transactions', 'queue_process', 'diagnostics_fix'
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  from_date timestamp with time zone,
  to_date timestamp with time zone,
  shop_id text,
  pages_fetched integer DEFAULT 0,
  transactions_fetched integer DEFAULT 0,
  subscriptions_fetched integer DEFAULT 0,
  already_exists integer DEFAULT 0,
  queued integer DEFAULT 0,
  processed integer DEFAULT 0,
  errors integer DEFAULT 0,
  status text DEFAULT 'running', -- 'running', 'completed', 'failed'
  error_message text,
  sample_uids text[], -- первые 5 UID для отладки
  meta jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Индекс для запросов по времени
CREATE INDEX IF NOT EXISTS idx_bepaid_sync_logs_started_at 
ON public.bepaid_sync_logs (started_at DESC);

-- RLS для bepaid_sync_logs (только для админов)
ALTER TABLE public.bepaid_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync logs" 
ON public.bepaid_sync_logs FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert sync logs" 
ON public.bepaid_sync_logs FOR INSERT 
WITH CHECK (true);

CREATE POLICY "System can update sync logs" 
ON public.bepaid_sync_logs FOR UPDATE 
USING (true);