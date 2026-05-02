CREATE TABLE IF NOT EXISTS public._inv22_overshoot_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  cohort text NOT NULL CHECK (cohort IN ('club','business','silent')),
  subscription_id uuid NOT NULL,
  user_id uuid,
  email text,
  telegram_user_id text,
  product_id uuid,
  product_name text,
  tariff_id uuid,
  tariff_name text,
  price numeric,
  price_source text,
  current_end_at timestamptz,
  correct_end_at timestamptz,
  is_expired_after_correction boolean NOT NULL,
  notify_required boolean NOT NULL,
  silent_backfill boolean NOT NULL DEFAULT false,
  revoke_required boolean NOT NULL,
  revoke_snapshot_bound boolean NOT NULL DEFAULT true,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_inv22_snap_snapshot ON public._inv22_overshoot_snapshot(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_inv22_snap_cohort ON public._inv22_overshoot_snapshot(snapshot_id, cohort);

ALTER TABLE public._inv22_overshoot_snapshot ENABLE ROW LEVEL SECURITY;
-- service_role bypass; никаких публичных политик не создаём (deny by default).