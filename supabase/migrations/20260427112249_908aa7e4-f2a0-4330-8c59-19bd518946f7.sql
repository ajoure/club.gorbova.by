-- telegram_audit_shape_runs: лог запусков audit-shape runner
CREATE TABLE public.telegram_audit_shape_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  scenario text NOT NULL CHECK (scenario IN (
    'INVITE_USED',
    'INVITE_MISMATCH',
    'INVITE_EXPIRED_OR_REUSED',
    'INVITE_BLOCKED_VERIFIED',
    'INVITE_REVOKED',
    'INVITE_CROSS_CLUB_BLOCKED'
  )),
  status text NOT NULL CHECK (status IN ('ok', 'denied', 'error')),
  audit_id uuid NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tg_audit_shape_runs_actor_created
  ON public.telegram_audit_shape_runs (actor_user_id, created_at DESC);

ALTER TABLE public.telegram_audit_shape_runs ENABLE ROW LEVEL SECURITY;

-- SELECT: только super-admin
CREATE POLICY "audit_shape_runs_select_superadmin"
ON public.telegram_audit_shape_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- НЕТ INSERT/UPDATE/DELETE policies для authenticated.
-- Запись только через service_role (edge functions), который bypass RLS.