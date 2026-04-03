-- ============================================
-- 1. Таблица live_events
-- ============================================
CREATE TABLE public.live_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  kinescope_video_id TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  access_rule JSONB NOT NULL DEFAULT '{"mode":"product","product_id":null,"tariff_id":null}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  is_published BOOLEAN NOT NULL DEFAULT false,
  scheduled_at TIMESTAMPTZ,
  replay_enabled BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы
CREATE INDEX idx_live_events_slug ON public.live_events(slug);
CREATE INDEX idx_live_events_product_id ON public.live_events(product_id);
CREATE INDEX idx_live_events_status ON public.live_events(status);

-- Триггер updated_at
CREATE TRIGGER update_live_events_updated_at
  BEFORE UPDATE ON public.live_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: admin-only
ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to live_events"
  ON public.live_events
  FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- ============================================
-- 2. Расширение broadcast_templates
-- ============================================
ALTER TABLE public.broadcast_templates
  ADD COLUMN template_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN live_event_id UUID REFERENCES public.live_events(id),
  ADD COLUMN targeting_tariff_id UUID REFERENCES public.tariffs(id);

CREATE INDEX idx_broadcast_templates_live_event_id ON public.broadcast_templates(live_event_id);
CREATE INDEX idx_broadcast_templates_template_type ON public.broadcast_templates(template_type);