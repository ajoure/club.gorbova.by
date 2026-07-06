CREATE TABLE public.inline_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  salt text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  flow_id text,
  purpose text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  last_send_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inline_otp_codes_email_created_idx
  ON public.inline_otp_codes (email, created_at DESC);
CREATE INDEX inline_otp_codes_active_idx
  ON public.inline_otp_codes (email, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inline_otp_codes TO service_role;

ALTER TABLE public.inline_otp_codes ENABLE ROW LEVEL SECURITY;

-- Explicit deny: no policies for anon/authenticated — service_role bypasses RLS.
-- (RLS enabled without policies = fully closed for anon/authenticated.)
