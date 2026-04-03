-- C2: Add activated_at to live_access_links
ALTER TABLE public.live_access_links ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- C3: Create live_active_sessions table
CREATE TABLE public.live_active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  client_instance_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique: one active (non-revoked) session per user per event
CREATE UNIQUE INDEX idx_live_active_sessions_user_event
  ON public.live_active_sessions(user_id, live_event_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_live_active_sessions_session_key ON public.live_active_sessions(session_key);
CREATE INDEX idx_live_active_sessions_expires ON public.live_active_sessions(expires_at);

ALTER TABLE public.live_active_sessions ENABLE ROW LEVEL SECURITY;

-- Admin-only access via has_role_v2 with correct _role_code parameter
CREATE POLICY "Admins can manage live_active_sessions"
  ON public.live_active_sessions FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));