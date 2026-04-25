-- 1. AUDIT BEFORE: snapshot dispatcher state
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
SELECT
  'broadcast_dispatcher_config_snapshot',
  'system',
  'sprint-b-scheduled-smoke',
  jsonb_build_object(
    'phase', 'before',
    'reason', 'Sprint B scheduled dry-run smoke #4/#5',
    'config', to_jsonb(c.*)
  )
FROM public.broadcast_dispatcher_config c WHERE c.id = 1;

-- 2. Enable dispatcher (production_approved stays FALSE — only dry_run allowed)
UPDATE public.broadcast_dispatcher_config
SET enabled = true,
    updated_at = now()
WHERE id = 1;

-- 3. AUDIT AFTER toggle
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
SELECT
  'broadcast_dispatcher_config_toggle',
  'system',
  'sprint-b-scheduled-smoke',
  jsonb_build_object(
    'phase', 'after_enable',
    'reason', 'Sprint B scheduled dry-run smoke #4/#5',
    'change', 'enabled: false -> true (production_approved stays false)',
    'config', to_jsonb(c.*)
  )
FROM public.broadcast_dispatcher_config c WHERE c.id = 1;

-- 4. Create smoke #4 template (Email-only scheduled)
INSERT INTO public.broadcast_templates (
  id, name, channel, channels, status, send_mode,
  email_subject, email_body_html, message_text,
  audience_filters, next_run_at, template_type,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '[Sprint B smoke #4] Scheduled Email-only test, ignore',
  'email',
  ARRAY['email']::text[],
  'scheduled',
  'scheduled',
  '[Sprint B smoke #4] Scheduled Email-only test, ignore',
  '<p>[Sprint B smoke #4] Scheduled Email-only test, ignore. Auto-test from dispatcher dry-run.</p>',
  '[Sprint B smoke #4] Scheduled Email-only test, ignore',
  jsonb_build_object(
    'product_context_id', '50ac58f2-81f8-4a65-a333-050dd173eab6',
    'tariff_ids', '[]'::jsonb,
    'club_ids', '[]'::jsonb,
    'club_membership', 'any',
    'include', jsonb_build_array(
      jsonb_build_object(
        'product_id', '50ac58f2-81f8-4a65-a333-050dd173eab6',
        'mode', 'active_access'
      )
    )
  ),
  now() - interval '1 minute',
  'general',
  now(), now()
);

-- 5. Create smoke #5 template (TG + Email scheduled)
INSERT INTO public.broadcast_templates (
  id, name, channel, channels, status, send_mode,
  email_subject, email_body_html, message_text,
  audience_filters, next_run_at, template_type,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '[Sprint B smoke #5] Scheduled TG+Email test, ignore',
  'telegram',
  ARRAY['telegram','email']::text[],
  'scheduled',
  'scheduled',
  '[Sprint B smoke #5] Scheduled TG+Email test, ignore',
  '<p>[Sprint B smoke #5] Scheduled TG+Email test, ignore. Auto-test from dispatcher dry-run.</p>',
  '[Sprint B smoke #5] Scheduled TG+Email test, ignore',
  jsonb_build_object(
    'product_context_id', '50ac58f2-81f8-4a65-a333-050dd173eab6',
    'tariff_ids', '[]'::jsonb,
    'club_ids', '[]'::jsonb,
    'club_membership', 'any',
    'include', jsonb_build_array(
      jsonb_build_object(
        'product_id', '50ac58f2-81f8-4a65-a333-050dd173eab6',
        'mode', 'active_access'
      )
    )
  ),
  now() - interval '1 minute',
  'general',
  now(), now()
);

-- 6. AUDIT: templates created
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
SELECT
  'broadcast_template_created_for_smoke',
  'system',
  'sprint-b-scheduled-smoke',
  jsonb_build_object(
    'reason', 'Sprint B scheduled dry-run smoke #4/#5',
    'template_id', t.id,
    'name', t.name,
    'channels', t.channels,
    'status', t.status,
    'send_mode', t.send_mode,
    'next_run_at', t.next_run_at,
    'audience_filters', t.audience_filters
  )
FROM public.broadcast_templates t
WHERE t.name LIKE '[Sprint B smoke #4]%'
   OR t.name LIKE '[Sprint B smoke #5]%';