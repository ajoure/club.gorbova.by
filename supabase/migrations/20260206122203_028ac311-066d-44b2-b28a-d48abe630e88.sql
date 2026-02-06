-- Таблица полных отчётов системного здоровья
CREATE TABLE public.system_health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('OK', 'DEGRADED', 'CRITICAL')),
  
  -- Инвентаризация Edge Functions
  edge_functions_total INTEGER NOT NULL DEFAULT 0,
  edge_functions_deployed INTEGER NOT NULL DEFAULT 0,
  edge_functions_missing TEXT[] DEFAULT '{}',
  
  -- P0 бизнес-инварианты
  invariants_total INTEGER NOT NULL DEFAULT 0,
  invariants_passed INTEGER NOT NULL DEFAULT 0,
  invariants_failed INTEGER NOT NULL DEFAULT 0,
  
  -- Автолечение
  auto_fixes JSONB DEFAULT '[]',
  auto_fixes_count INTEGER NOT NULL DEFAULT 0,
  
  -- Полный отчёт
  report_json JSONB NOT NULL DEFAULT '{}',
  
  -- Метаданные
  source TEXT NOT NULL DEFAULT 'manual',
  duration_ms INTEGER,
  triggered_by UUID,
  telegram_notified BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_system_health_reports_status ON public.system_health_reports(status);
CREATE INDEX idx_system_health_reports_created_at ON public.system_health_reports(created_at DESC);

-- RLS
ALTER TABLE public.system_health_reports ENABLE ROW LEVEL SECURITY;

-- Только superadmin может читать (используем колонку role напрямую)
CREATE POLICY "Superadmins can read system_health_reports"
  ON public.system_health_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'superadmin'
    )
  );

-- Системные записи (service_role)
CREATE POLICY "Service role can insert system_health_reports"
  ON public.system_health_reports
  FOR INSERT
  WITH CHECK (TRUE);

COMMENT ON TABLE public.system_health_reports IS 'Полные отчёты проверки системы от system-health-full-check';