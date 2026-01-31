-- PATCH 5: Create monitoring tables for nightly system health
-- system_health_runs: History of nightly monitoring runs
CREATE TABLE IF NOT EXISTS public.system_health_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL DEFAULT 'nightly',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  summary JSONB,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- system_health_checks: Individual check results per run
CREATE TABLE IF NOT EXISTS public.system_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.system_health_runs(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL,
  check_name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB,
  sample_rows JSONB,
  count INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_health_runs_status ON public.system_health_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_runs_started ON public.system_health_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_run ON public.system_health_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_status ON public.system_health_checks(status, check_key);

-- Enable RLS
ALTER TABLE public.system_health_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies: service_role full access, admins read-only
CREATE POLICY "Service role full access on system_health_runs" 
ON public.system_health_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on system_health_checks" 
ON public.system_health_checks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read system_health_runs"
ON public.system_health_runs FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Admins can read system_health_checks"
ON public.system_health_checks FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- PATCH 2: Add payment_classification column to payments_v2
ALTER TABLE public.payments_v2 
ADD COLUMN IF NOT EXISTS payment_classification TEXT;

COMMENT ON COLUMN public.payments_v2.payment_classification IS 
'Classification: card_verification | trial_purchase | regular_purchase | subscription_renewal | refund | orphan_technical';

-- PATCH 8: Create RPC for finding wrongly revoked users (set-based, no N+1)
CREATE OR REPLACE FUNCTION public.rpc_find_wrongly_revoked()
RETURNS TABLE (
  member_id UUID,
  telegram_user_id BIGINT,
  access_status TEXT,
  profile_id UUID,
  user_id UUID,
  has_subscription BOOLEAN,
  has_entitlement BOOLEAN,
  has_manual_access BOOLEAN,
  full_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
BEGIN
  RETURN QUERY
  WITH revoked_members AS (
    SELECT 
      tcm.id as member_id,
      tcm.telegram_user_id,
      tcm.access_status,
      tcm.profile_id,
      p.user_id,
      p.full_name
    FROM telegram_club_members tcm
    LEFT JOIN profiles p ON p.id = tcm.profile_id
    WHERE tcm.access_status IN ('removed', 'expired', 'kicked', 'no_access')
      AND p.user_id IS NOT NULL
  ),
  with_subscriptions AS (
    SELECT rm.*, 
      EXISTS (
        SELECT 1 FROM subscriptions_v2 s
        WHERE s.user_id = rm.user_id
          AND s.status IN ('active', 'trial', 'past_due')
          AND s.access_end_at > now_ts
      ) as has_sub
    FROM revoked_members rm
  ),
  with_entitlements AS (
    SELECT ws.*,
      EXISTS (
        SELECT 1 FROM entitlements e
        WHERE e.user_id = ws.user_id
          AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > now_ts)
      ) as has_ent
    FROM with_subscriptions ws
  ),
  with_manual AS (
    SELECT we.*,
      EXISTS (
        SELECT 1 FROM telegram_manual_access tma
        WHERE tma.user_id = we.user_id
          AND tma.is_active = true
          AND (tma.valid_until IS NULL OR tma.valid_until > now_ts)
      ) as has_manual
    FROM with_entitlements we
  )
  SELECT 
    wm.member_id,
    wm.telegram_user_id,
    wm.access_status,
    wm.profile_id,
    wm.user_id,
    wm.has_sub as has_subscription,
    wm.has_ent as has_entitlement,
    wm.has_manual as has_manual_access,
    wm.full_name
  FROM with_manual wm
  WHERE wm.has_sub OR wm.has_ent OR wm.has_manual;
END;
$$;