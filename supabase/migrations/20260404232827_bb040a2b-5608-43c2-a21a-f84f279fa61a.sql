CREATE TABLE public.live_event_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.broadcast_templates(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
  notify_offset_minutes INTEGER NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(live_event_id, user_id, channel, notify_offset_minutes)
);

ALTER TABLE public.live_event_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage notification log"
  ON public.live_event_notification_log
  FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE INDEX idx_live_notif_log_event ON public.live_event_notification_log(live_event_id);
CREATE INDEX idx_live_notif_log_status ON public.live_event_notification_log(status) WHERE status = 'pending';