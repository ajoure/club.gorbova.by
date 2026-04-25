-- Revert dispatcher to OFF
UPDATE public.broadcast_dispatcher_config
SET enabled = false,
    updated_at = now()
WHERE id = 1;

-- AUDIT
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
SELECT
  'broadcast_dispatcher_config_toggle',
  'system',
  'sprint-b-scheduled-smoke',
  jsonb_build_object(
    'phase', 'after_revert',
    'reason', 'Sprint B scheduled dry-run smoke #4/#5 — revert',
    'change', 'enabled: true -> false (production_approved still false)',
    'config', to_jsonb(c.*)
  )
FROM public.broadcast_dispatcher_config c WHERE c.id = 1;