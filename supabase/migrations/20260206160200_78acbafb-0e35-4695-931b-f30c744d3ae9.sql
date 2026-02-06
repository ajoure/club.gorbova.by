-- Таблица логов деплоя Edge Functions для корреляции 404 инцидентов
CREATE TABLE IF NOT EXISTS public.deploy_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  commit_sha text NOT NULL,
  run_number integer,
  deployed_functions text[] NOT NULL DEFAULT '{}',
  failed_functions text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Индекс для быстрого поиска по времени
CREATE INDEX IF NOT EXISTS idx_deploy_logs_started_at ON public.deploy_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_run_id ON public.deploy_logs(run_id);

-- Enable RLS
ALTER TABLE public.deploy_logs ENABLE ROW LEVEL SECURITY;

-- Только админы могут читать deploy_logs
CREATE POLICY "Admins can read deploy_logs"
  ON public.deploy_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles_v2 ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.code IN ('admin', 'super_admin')
    )
  );

-- Service role может писать (для CI)
CREATE POLICY "Service role can insert deploy_logs"
  ON public.deploy_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update deploy_logs"
  ON public.deploy_logs
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);