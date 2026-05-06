-- Sprint 3: token aliases + auto-generation feature flag

CREATE TABLE IF NOT EXISTS public.document_token_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_token text NOT NULL,
  canonical_token_key text NOT NULL REFERENCES public.document_token_registry(token_key) ON UPDATE CASCADE,
  template_id uuid NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
  template_version_id uuid NULL REFERENCES public.document_template_versions(id) ON DELETE CASCADE,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Unique scope: одинаковый alias не должен дублироваться в одной области (global / template / version)
CREATE UNIQUE INDEX IF NOT EXISTS document_token_aliases_scope_uniq
  ON public.document_token_aliases (
    alias_token,
    COALESCE(template_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(template_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS document_token_aliases_canonical_idx
  ON public.document_token_aliases (canonical_token_key);

ALTER TABLE public.document_token_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_token_aliases_admin_all ON public.document_token_aliases;
CREATE POLICY document_token_aliases_admin_all
  ON public.document_token_aliases
  FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'owner'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'owner'));

-- Feature flag (по умолчанию OFF)
INSERT INTO public.app_settings (key, value)
VALUES ('documents_service_act_auto_generation_enabled', to_jsonb(false))
ON CONFLICT (key) DO NOTHING;