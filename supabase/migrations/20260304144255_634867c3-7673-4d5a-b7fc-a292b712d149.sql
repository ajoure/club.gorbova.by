
CREATE TABLE public.admin_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
  content_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  UNIQUE (section_key, version_label)
);

ALTER TABLE public.admin_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_docs_select" ON public.admin_docs
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "admin_docs_insert" ON public.admin_docs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "admin_docs_update" ON public.admin_docs
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "admin_docs_delete" ON public.admin_docs
  FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));
