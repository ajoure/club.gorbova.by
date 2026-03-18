-- =============================================
-- Site Builder: tables, triggers, RLS, sequences
-- =============================================

-- 1. site_pages (full entity)
CREATE TABLE public.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT '',
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  product_id uuid REFERENCES public.products_v2(id) ON DELETE SET NULL,
  blocks jsonb NOT NULL DEFAULT '[]',
  seo_settings jsonb NOT NULL DEFAULT '{}',
  theme_settings jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_pages_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  CONSTRAINT site_pages_status_check CHECK (status IN ('draft', 'published'))
);

-- 2. site_domain_bindings (full entity)
CREATE TABLE public.site_domain_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT '',
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  site_page_id uuid NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  domain text UNIQUE NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  updated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. domain_events (platform infrastructure - append-only log, NOT a business entity)
CREATE TABLE public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source text NOT NULL,
  entity_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. domain_executions (platform infrastructure - NOT a business entity)
CREATE TABLE public.domain_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.domain_events(id),
  step text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  attempt integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_executions_status_check CHECK (status IN ('pending', 'success', 'failed', 'retrying'))
);

-- 5. public_id sequences
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('site_page', 'SITE', 0), ('site_domain_binding', 'SDB', 0)
ON CONFLICT DO NOTHING;

-- 6. Trigger functions for public_id
CREATE OR REPLACE FUNCTION public.set_site_page_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('site_page');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_site_domain_binding_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('site_domain_binding');
  END IF;
  RETURN NEW;
END;
$$;

-- 7. Triggers: public_id
CREATE TRIGGER trg_site_pages_public_id
  BEFORE INSERT ON public.site_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_site_page_public_id();

CREATE TRIGGER trg_site_domain_bindings_public_id
  BEFORE INSERT ON public.site_domain_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_site_domain_binding_public_id();

-- 8. Triggers: updated_at
CREATE TRIGGER trg_site_pages_updated_at
  BEFORE UPDATE ON public.site_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_site_domain_bindings_updated_at
  BEFORE UPDATE ON public.site_domain_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Indexes
CREATE INDEX idx_site_pages_status ON public.site_pages(status);
CREATE INDEX idx_site_pages_slug ON public.site_pages(slug);
CREATE INDEX idx_site_domain_bindings_domain ON public.site_domain_bindings(domain);
CREATE INDEX idx_domain_events_entity ON public.domain_events(entity_id);
CREATE INDEX idx_domain_events_type ON public.domain_events(event_type);
CREATE INDEX idx_domain_executions_event ON public.domain_executions(event_id);

-- 10. RLS
ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_domain_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_executions ENABLE ROW LEVEL SECURITY;

-- site_pages policies
CREATE POLICY "site_pages_admin_select" ON public.site_pages
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_pages_public_select" ON public.site_pages
  FOR SELECT TO anon
  USING (status = 'published');

CREATE POLICY "site_pages_admin_insert" ON public.site_pages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_pages_admin_update" ON public.site_pages
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_pages_superadmin_delete" ON public.site_pages
  FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

-- site_domain_bindings policies
CREATE POLICY "site_domain_bindings_public_select" ON public.site_domain_bindings
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "site_domain_bindings_admin_select" ON public.site_domain_bindings
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_domain_bindings_admin_insert" ON public.site_domain_bindings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_domain_bindings_admin_update" ON public.site_domain_bindings
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "site_domain_bindings_admin_delete" ON public.site_domain_bindings
  FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- domain_events policies
CREATE POLICY "domain_events_admin_select" ON public.domain_events
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "domain_events_admin_insert" ON public.domain_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- domain_executions policies
CREATE POLICY "domain_executions_admin_select" ON public.domain_executions
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "domain_executions_admin_insert" ON public.domain_executions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "domain_executions_admin_update" ON public.domain_executions
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));