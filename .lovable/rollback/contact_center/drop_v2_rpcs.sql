-- ROLLBACK — drop V2 RPCs after frontend rolled back to compatibility flow.
-- Применять ТОЛЬКО после подтверждённого отсутствия вызовов
-- mark_dialog_read_v2 / bulk_mark_dialogs_read_v2.

DROP FUNCTION IF EXISTS public.mark_dialog_read_v2(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.bulk_mark_dialogs_read_v2(jsonb);
