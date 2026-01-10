-- Add reentry penalty waiver columns expected by UI and backend functions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reentry_penalty_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reentry_penalty_waived_by uuid,
  ADD COLUMN IF NOT EXISTS reentry_penalty_waived_at timestamptz;