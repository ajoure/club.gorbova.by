
-- ============================================================================
-- Post-payment notification infrastructure
-- ============================================================================

-- 1) Delivery journal (idempotency SoT)
CREATE TABLE IF NOT EXISTS public.order_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('telegram', 'email')),
  notification_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  provider_message_id text NULL,
  error text NULL,
  recipient text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_notification_deliveries_unique
    UNIQUE (order_id, channel, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_ond_order ON public.order_notification_deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_ond_status ON public.order_notification_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_ond_created_at ON public.order_notification_deliveries(created_at DESC);

GRANT SELECT ON public.order_notification_deliveries TO authenticated;
GRANT ALL ON public.order_notification_deliveries TO service_role;

ALTER TABLE public.order_notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ond_admins_read"
  ON public.order_notification_deliveries
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ond_service_all"
  ON public.order_notification_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.tg_order_notification_deliveries_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ond_updated_at ON public.order_notification_deliveries;
CREATE TRIGGER trg_ond_updated_at
  BEFORE UPDATE ON public.order_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_notification_deliveries_updated_at();

-- 2) Per-product template overrides
CREATE TABLE IF NOT EXISTS public.product_notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('telegram', 'email')),
  subject_override text NULL,
  intro_html text NULL,
  intro_text text NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_notification_templates_unique
    UNIQUE (product_id, notification_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_pnt_product ON public.product_notification_templates(product_id);

GRANT SELECT ON public.product_notification_templates TO authenticated;
GRANT ALL ON public.product_notification_templates TO service_role;

ALTER TABLE public.product_notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pnt_admins_manage"
  ON public.product_notification_templates
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "pnt_service_all"
  ON public.product_notification_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_pnt_updated_at ON public.product_notification_templates;
CREATE TRIGGER trg_pnt_updated_at
  BEFORE UPDATE ON public.product_notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_notification_deliveries_updated_at();
