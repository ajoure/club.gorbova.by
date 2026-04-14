
-- ============================================================
-- 1. crm_pipelines
-- ============================================================
CREATE TABLE public.crm_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL DEFAULT ('PL-' || substr(gen_random_uuid()::text, 1, 8)),
  name TEXT NOT NULL,
  code TEXT,
  order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX uq_crm_pipelines_public_id ON public.crm_pipelines (public_id);
CREATE UNIQUE INDEX uq_crm_pipelines_order_index ON public.crm_pipelines (order_index);

-- updated_at trigger
CREATE TRIGGER update_crm_pipelines_updated_at
  BEFORE UPDATE ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_pipelines_select" ON public.crm_pipelines
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "crm_pipelines_insert" ON public.crm_pipelines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipelines_update" ON public.crm_pipelines
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipelines_delete" ON public.crm_pipelines
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

-- ============================================================
-- 2. crm_pipeline_stages
-- ============================================================
CREATE TABLE public.crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL DEFAULT ('PS-' || substr(gen_random_uuid()::text, 1, 8)),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  stage_type TEXT NOT NULL DEFAULT 'open'
    CHECK (stage_type IN ('open', 'closed_won', 'closed_lost')),
  order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX uq_crm_pipeline_stages_public_id ON public.crm_pipeline_stages (public_id);
CREATE UNIQUE INDEX uq_crm_pipeline_stages_order ON public.crm_pipeline_stages (pipeline_id, order_index);

CREATE TRIGGER update_crm_pipeline_stages_updated_at
  BEFORE UPDATE ON public.crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_pipeline_stages_select" ON public.crm_pipeline_stages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "crm_pipeline_stages_insert" ON public.crm_pipeline_stages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipeline_stages_update" ON public.crm_pipeline_stages
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipeline_stages_delete" ON public.crm_pipeline_stages
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

-- ============================================================
-- 3. crm_pipeline_product_bindings
-- ============================================================
CREATE TABLE public.crm_pipeline_product_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL DEFAULT ('PB-' || substr(gen_random_uuid()::text, 1, 8)),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE RESTRICT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (pipeline_id, product_id)
);

CREATE UNIQUE INDEX uq_crm_pipeline_product_bindings_public_id ON public.crm_pipeline_product_bindings (public_id);

CREATE TRIGGER update_crm_pipeline_product_bindings_updated_at
  BEFORE UPDATE ON public.crm_pipeline_product_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crm_pipeline_product_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_pipeline_product_bindings_select" ON public.crm_pipeline_product_bindings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "crm_pipeline_product_bindings_insert" ON public.crm_pipeline_product_bindings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipeline_product_bindings_update" ON public.crm_pipeline_product_bindings
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "crm_pipeline_product_bindings_delete" ON public.crm_pipeline_product_bindings
  FOR DELETE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  );

-- ============================================================
-- 4. Columns on orders_v2
-- ============================================================
ALTER TABLE public.orders_v2
  ADD COLUMN pipeline_id UUID REFERENCES public.crm_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN pipeline_stage_id UUID REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL;

-- ============================================================
-- 5. Validation trigger: pipeline_stage_id must belong to pipeline_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_deal_pipeline_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If both are set, stage must belong to the pipeline
  IF NEW.pipeline_id IS NOT NULL AND NEW.pipeline_stage_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_pipeline_stages
      WHERE id = NEW.pipeline_stage_id AND pipeline_id = NEW.pipeline_id
    ) THEN
      RAISE EXCEPTION 'pipeline_stage_id does not belong to the specified pipeline_id';
    END IF;
  END IF;
  -- If stage is set but pipeline is not, auto-fill pipeline_id
  IF NEW.pipeline_id IS NULL AND NEW.pipeline_stage_id IS NOT NULL THEN
    SELECT pipeline_id INTO NEW.pipeline_id
    FROM public.crm_pipeline_stages
    WHERE id = NEW.pipeline_stage_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_deal_pipeline_stage
  BEFORE INSERT OR UPDATE ON public.orders_v2
  FOR EACH ROW
  WHEN (NEW.pipeline_stage_id IS NOT NULL OR NEW.pipeline_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_deal_pipeline_stage();

-- ============================================================
-- 6. Uniqueness guards: only one default pipeline, one default stage per pipeline
-- ============================================================
CREATE UNIQUE INDEX uq_crm_pipelines_default
  ON public.crm_pipelines (is_default) WHERE is_default = true;

CREATE UNIQUE INDEX uq_crm_pipeline_stages_default
  ON public.crm_pipeline_stages (pipeline_id, is_default) WHERE is_default = true;

-- ============================================================
-- 7. Seed default pipeline + 4 stages
-- ============================================================
INSERT INTO public.crm_pipelines (name, code, order_index, is_default)
VALUES ('Основная', 'default', 0, true);

INSERT INTO public.crm_pipeline_stages (pipeline_id, name, color, order_index, stage_type, is_default)
VALUES
  ((SELECT id FROM public.crm_pipelines WHERE code = 'default'), 'Новая',    '#6366f1', 0, 'open', true),
  ((SELECT id FROM public.crm_pipelines WHERE code = 'default'), 'В работе', '#f59e0b', 1, 'open', false),
  ((SELECT id FROM public.crm_pipelines WHERE code = 'default'), 'Успешно',  '#22c55e', 2, 'closed_won', false),
  ((SELECT id FROM public.crm_pipelines WHERE code = 'default'), 'Отказ',    '#ef4444', 3, 'closed_lost', false);
