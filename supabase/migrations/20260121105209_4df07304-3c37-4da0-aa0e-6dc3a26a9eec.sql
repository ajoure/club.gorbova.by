-- Таблица RUN-ов синхронизации платежей
CREATE TABLE IF NOT EXISTS payments_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('bepaid_api', 'import_csv')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'stopped')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  
  -- Progress tracking
  total_pages INTEGER DEFAULT 0,
  processed_pages INTEGER DEFAULT 0,
  current_cursor JSONB,
  
  -- Final stats
  stats JSONB DEFAULT '{}'::jsonb,
  -- Example stats structure:
  -- {
  --   "scanned": 0,
  --   "inserted": 0,
  --   "updated": 0,
  --   "unchanged": 0,
  --   "errors": 0,
  --   "amount_sum_before": 0,
  --   "amount_sum_after": 0,
  --   "diff_count": 0,
  --   "diff_amount": 0,
  --   "error_samples": []
  -- }
  
  error TEXT,
  initiated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Включить RLS
ALTER TABLE payments_sync_runs ENABLE ROW LEVEL SECURITY;

-- Политика: только админы могут читать
CREATE POLICY "Admin read payments_sync_runs"
  ON payments_sync_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Политика: только админы могут создавать
CREATE POLICY "Admin insert payments_sync_runs"
  ON payments_sync_runs FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Политика: system (service role) может обновлять
CREATE POLICY "System update payments_sync_runs"
  ON payments_sync_runs FOR UPDATE
  USING (true);

-- Индекс для быстрого поиска активных RUN-ов
CREATE INDEX idx_payments_sync_runs_status ON payments_sync_runs(status) WHERE status IN ('pending', 'running');

-- Индекс для поиска по дате
CREATE INDEX idx_payments_sync_runs_created_at ON payments_sync_runs(created_at DESC);

-- Триггер для updated_at
CREATE TRIGGER update_payments_sync_runs_updated_at
  BEFORE UPDATE ON payments_sync_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();