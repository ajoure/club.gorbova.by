-- =========================================================================
-- Ревизия orders_v2 для product_id = 7101ed3c-7839-4a74-ad95-aa0660369b22
-- Batch: REVISION-7101ed3c-20260425T130602Z
-- ==========================================================================

-- 1) BACKUP всех orders_v2 по продукту
DROP TABLE IF EXISTS public.rev_7101ed3c_backup;
CREATE TABLE public.rev_7101ed3c_backup AS
SELECT * FROM orders_v2 WHERE product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22';
ALTER TABLE public.rev_7101ed3c_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY rev_backup_admin_only ON public.rev_7101ed3c_backup FOR SELECT USING (false);

-- 2) Главный DO-блок: операции грузим из локального JSON-каталога (см. /tmp/rev/MIGRATION.sql)
-- ВНИМАНИЕ: тело DO-блока — 90 KB JSON-payload + логика. Подаётся отдельным шагом.
SELECT 'Migration shell created, run /tmp/rev/MIGRATION.sql DO-block as next step' AS status;