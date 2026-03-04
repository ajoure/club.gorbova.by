
CREATE TABLE public.fields_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT '{}'::jsonb,
  archived_at timestamptz NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  UNIQUE(entity_type, key)
);

CREATE TABLE public.field_values_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES public.fields_registry(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  value jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(field_id, entity_id)
);

ALTER TABLE public.fields_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_values_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read fields_registry"
  ON public.fields_registry FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  );

CREATE POLICY "Super admin can manage fields_registry"
  ON public.fields_registry FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role));

CREATE POLICY "Admin can read field_values_v2"
  ON public.field_values_v2 FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  );

CREATE POLICY "Admin can manage field_values_v2"
  ON public.field_values_v2 FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  );
