CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  provider text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  display_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integrations_ws_provider_uniq UNIQUE (workspace_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_staff_rw ON public.integrations;
CREATE POLICY integrations_staff_rw ON public.integrations
  FOR ALL TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'staff')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'staff')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.tg_integrations_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS integrations_touch_updated_at ON public.integrations;
CREATE TRIGGER integrations_touch_updated_at BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_integrations_touch_updated_at();

INSERT INTO public.integrations (workspace_id, provider, is_enabled, display_name, config)
SELECT DISTINCT ic.workspace_id, 'vochi', (ic.status = 'active'),
       'VOCHI', COALESCE(ic.config, '{}'::jsonb) - 'enabled'
FROM public.integration_credentials ic
WHERE ic.provider = 'vochi'
ON CONFLICT (workspace_id, provider) DO NOTHING;