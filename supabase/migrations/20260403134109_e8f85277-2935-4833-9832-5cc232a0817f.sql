-- Create access rules table for live events (multi-product/tariff access)
CREATE TABLE public.live_event_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  tariff_id UUID REFERENCES public.tariffs(id),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(live_event_id, product_id, tariff_id)
);

CREATE INDEX idx_live_event_access_rules_event ON public.live_event_access_rules(live_event_id);

ALTER TABLE public.live_event_access_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage live_event_access_rules"
  ON public.live_event_access_rules FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- Make product_id and kinescope_video_id nullable on live_events (legacy fallback)
ALTER TABLE public.live_events ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.live_events ALTER COLUMN kinescope_video_id DROP NOT NULL;