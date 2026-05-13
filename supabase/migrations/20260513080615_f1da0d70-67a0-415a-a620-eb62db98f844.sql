UPDATE audit_logs
SET actor_user_id = '05cd3754-d589-4d90-97d1-89ba2bee610b',
    actor_label = '7500084@gmail.com',
    meta = meta || jsonb_build_object('actor_corrected_at', now()::text)
WHERE action = 'inv22.repair_provider_dead_local_active'
  AND meta->>'backfill_reason' = 'resolve_audit_silent_fail_2026-05-13'
  AND actor_user_id = '81b9bb78-7af6-4dc6-9e0a-77b41a8a5fe3';