-- Финальный sprint PATCH F6/F7: безопасные FK на live_events
-- broadcast_templates и crm_activity_log носят характер исторических/audit-данных,
-- поэтому при удалении эфира разрываем ссылку (SET NULL), а запись сохраняем.

ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_live_event_id_fkey;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_live_event_id_fkey
  FOREIGN KEY (live_event_id) REFERENCES public.live_events(id) ON DELETE SET NULL;

ALTER TABLE public.crm_activity_log
  DROP CONSTRAINT IF EXISTS crm_activity_log_live_event_id_fkey;

ALTER TABLE public.crm_activity_log
  ADD CONSTRAINT crm_activity_log_live_event_id_fkey
  FOREIGN KEY (live_event_id) REFERENCES public.live_events(id) ON DELETE SET NULL;