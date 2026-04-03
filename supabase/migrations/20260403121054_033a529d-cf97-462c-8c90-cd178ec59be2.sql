-- Таблица серверных proof-записей (пропусков доступа)
CREATE TABLE public.live_access_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  link_id UUID REFERENCES public.live_access_links(id) ON DELETE SET NULL,
  proof_type TEXT NOT NULL DEFAULT 'invite_consumed',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique per user+event (latest proof wins; old expired proofs cleaned or overwritten via upsert)
CREATE UNIQUE INDEX idx_live_access_proofs_user_event
  ON public.live_access_proofs(user_id, live_event_id);

-- Lookup indexes
CREATE INDEX idx_live_access_proofs_event ON public.live_access_proofs(live_event_id);
CREATE INDEX idx_live_access_proofs_expires ON public.live_access_proofs(expires_at);

-- RLS: admin-only
ALTER TABLE public.live_access_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage live_access_proofs"
  ON public.live_access_proofs
  FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));