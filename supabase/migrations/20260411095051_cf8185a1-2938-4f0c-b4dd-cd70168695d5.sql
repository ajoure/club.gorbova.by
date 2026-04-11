-- Repair stale telegram_access.active_until for user dd5e4180
UPDATE public.telegram_access
SET active_until = '2026-05-07 20:59:59+00',
    updated_at = now()
WHERE id = '64171de8-4162-4cfd-83db-b302901ad27f'
  AND user_id = 'dd5e4180-e0fb-45b3-941e-8b09dd85970d'
  AND club_id = 'fa547c41-3a84-4c4f-904a-427332a0506e';

-- Audit log for the repair
INSERT INTO public.audit_logs (actor_type, actor_label, action, target_user_id, meta)
VALUES (
  'system',
  'bepaid-webhook-patch-repair',
  'telegram_access.repaired',
  'dd5e4180-e0fb-45b3-941e-8b09dd85970d',
  jsonb_build_object(
    'telegram_access_id', '64171de8-4162-4cfd-83db-b302901ad27f',
    'club_id', 'fa547c41-3a84-4c4f-904a-427332a0506e',
    'old_active_until', '2026-04-07T06:08:11.592Z',
    'new_active_until', '2026-05-07T20:59:59Z',
    'subscription_v2_id', '78e62ef3-2bbb-452b-9153-0ef3bfca1c8a',
    'reason', 'stale_tg_active_until_repair'
  )
);