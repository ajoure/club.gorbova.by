-- Таблица одноразовых пригласительных ссылок
CREATE TABLE public.live_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  expires_at TIMESTAMPTZ NOT NULL,
  sent_via TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_opened_by_user_id UUID,
  last_opened_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: valid statuses only
ALTER TABLE public.live_access_links
  ADD CONSTRAINT chk_live_access_links_status
  CHECK (status IN ('created', 'sent', 'consumed', 'expired', 'revoked', 'mismatch'));

-- Unique token_hash
CREATE UNIQUE INDEX idx_live_access_links_token_hash ON public.live_access_links(token_hash);

-- One active link per user per event
CREATE UNIQUE INDEX idx_live_access_links_active_unique
  ON public.live_access_links(user_id, live_event_id)
  WHERE status IN ('created', 'sent');

-- Lookup indexes
CREATE INDEX idx_live_access_links_event ON public.live_access_links(live_event_id);
CREATE INDEX idx_live_access_links_user ON public.live_access_links(user_id);
CREATE INDEX idx_live_access_links_status ON public.live_access_links(status);
CREATE INDEX idx_live_access_links_expires ON public.live_access_links(expires_at);

-- RLS: admin-only
ALTER TABLE public.live_access_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage live_access_links"
  ON public.live_access_links
  FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_live_access_links_updated_at
  BEFORE UPDATE ON public.live_access_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();