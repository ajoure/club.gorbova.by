-- Заменить CHECK-constraint на сценарии (правка: INVITE_BLOCKED_CROSS_CLUB)
ALTER TABLE public.telegram_audit_shape_runs
  DROP CONSTRAINT telegram_audit_shape_runs_scenario_check;

ALTER TABLE public.telegram_audit_shape_runs
  ADD CONSTRAINT telegram_audit_shape_runs_scenario_check
  CHECK (scenario IN (
    'INVITE_USED',
    'INVITE_MISMATCH',
    'INVITE_EXPIRED_OR_REUSED',
    'INVITE_BLOCKED_VERIFIED',
    'INVITE_REVOKED',
    'INVITE_BLOCKED_CROSS_CLUB'
  ));