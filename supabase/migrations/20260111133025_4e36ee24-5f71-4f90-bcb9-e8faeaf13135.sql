-- Таблица для отслеживания задач фонового импорта
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  created_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  error_log JSONB,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: пользователи видят только свои задачи
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own import jobs" ON import_jobs
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create import jobs" ON import_jobs
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own import jobs" ON import_jobs
  FOR UPDATE USING (auth.uid() = created_by);

-- Индекс для быстрого поиска по статусу и создателю
CREATE INDEX idx_import_jobs_created_by ON import_jobs(created_by);
CREATE INDEX idx_import_jobs_status ON import_jobs(status);

-- Включить realtime для отслеживания прогресса
ALTER PUBLICATION supabase_realtime ADD TABLE import_jobs;

COMMENT ON TABLE import_jobs IS 'Задачи фонового импорта контактов из amoCRM и других источников';