-- Sprint B rev3 — Фаза 1: metadata + paused status

-- 1) metadata jsonb для хранения служебных данных (paused_from_status, deleted_at и т.п.)
ALTER TABLE public.broadcast_templates
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Расширяем допустимые статусы: добавляем 'paused'
ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_status_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sent'::text, 'archived'::text, 'recurring'::text, 'paused'::text]));

-- 3) Индекс для каноничной таблицы (фильтры по статусу + сортировка по next_run_at)
CREATE INDEX IF NOT EXISTS idx_broadcast_templates_status_next_run
  ON public.broadcast_templates (status, next_run_at NULLS LAST);

-- Note: dispatcher (process-scheduled-broadcasts) уже фильтрует по
--   status IN ('scheduled','recurring'), поэтому 'paused' и 'archived' автоматически НЕ обрабатываются.