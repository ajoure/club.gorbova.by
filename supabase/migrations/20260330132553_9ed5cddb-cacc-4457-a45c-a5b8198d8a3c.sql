
-- Access Rules: unified rule layer for product/tariff access grants
CREATE TABLE public.access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Scope: rule applies to product and/or tariff
  product_id UUID REFERENCES public.products_v2(id) ON DELETE CASCADE,
  tariff_id UUID REFERENCES public.tariffs(id) ON DELETE CASCADE,
  
  -- Grant target
  grant_target_type TEXT NOT NULL CHECK (grant_target_type IN ('entitlement', 'club', 'email', 'product_access')),
  target_ref TEXT NOT NULL,          -- club_id, email_account_id, product_code, etc.
  target_label TEXT,                 -- human-readable label for UI
  
  -- Config
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER,             -- override duration, null = use tariff default
  conditions JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  
  -- Metadata
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- At least one scope must be set
  CONSTRAINT access_rules_scope_check CHECK (product_id IS NOT NULL OR tariff_id IS NOT NULL),
  -- Prevent duplicate rules for same scope+target
  CONSTRAINT access_rules_unique_target UNIQUE (product_id, tariff_id, grant_target_type, target_ref)
);

-- Index for fast lookups
CREATE INDEX idx_access_rules_product ON public.access_rules(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_access_rules_tariff ON public.access_rules(tariff_id) WHERE tariff_id IS NOT NULL;
CREATE INDEX idx_access_rules_active ON public.access_rules(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE public.access_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read access_rules"
  ON public.access_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage access_rules"
  ON public.access_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER set_access_rules_updated_at
  BEFORE UPDATE ON public.access_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
