-- Companies Phase 9A: provider-neutral external identifiers.
-- Direct table access stays closed; the guarded RPCs are the adapter boundary
-- for future AMO/Bitrix/import jobs.

CREATE TABLE IF NOT EXISTS public.company_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  external_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT company_external_ids_provider_chk CHECK (provider ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT company_external_ids_value_chk CHECK (length(btrim(external_id)) BETWEEN 1 AND 256)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_external_ids_company_provider_uniq
  ON public.company_external_ids(company_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS company_external_ids_provider_value_uniq
  ON public.company_external_ids(provider, external_id);
CREATE INDEX IF NOT EXISTS company_external_ids_company_idx
  ON public.company_external_ids(company_id, provider);

DROP TRIGGER IF EXISTS update_company_external_ids_updated_at ON public.company_external_ids;
CREATE TRIGGER update_company_external_ids_updated_at
  BEFORE UPDATE ON public.company_external_ids
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.company_external_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_external_ids FROM anon, authenticated;
GRANT ALL ON public.company_external_ids TO service_role;

CREATE OR REPLACE FUNCTION public.crm_company_external_ids_list(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher') OR has_role_v2(v_uid, 'support')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(e) ORDER BY e.provider)
      FROM public.company_external_ids e
     WHERE e.company_id = _company_id
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_external_id_upsert(
  _company_id uuid,
  _provider text,
  _external_id text,
  _external_url text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_provider text := lower(btrim(_provider));
  v_external_id text := btrim(_external_id);
BEGIN
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _company_id AND c.status <> 'merged') THEN
    RAISE EXCEPTION 'company not found or merged' USING ERRCODE = '23503';
  END IF;
  IF v_provider !~ '^[a-z][a-z0-9_.-]{1,63}$' OR length(v_external_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invalid external identifier' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_external_ids (company_id, provider, external_id, external_url, metadata, created_by, updated_by)
  VALUES (_company_id, v_provider, v_external_id, NULLIF(btrim(_external_url), ''), COALESCE(_metadata, '{}'::jsonb), v_uid, v_uid)
  ON CONFLICT (company_id, provider) DO UPDATE
    SET external_id = EXCLUDED.external_id,
        external_url = EXCLUDED.external_url,
        metadata = EXCLUDED.metadata,
        updated_by = v_uid,
        updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type, user_id, idempotency_key, title_snapshot, text_snapshot, metadata)
  SELECT 'company.external_id.updated', _company_id, 'company', v_uid,
         'company.external_id.updated:' || v_id::text || ':' || v_external_id,
         'Внешний идентификатор обновлён', v_provider || ': ' || v_external_id,
         jsonb_build_object('provider', v_provider, 'external_id', v_external_id)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.crm_activity_log a
      WHERE a.idempotency_key = 'company.external_id.updated:' || v_id::text || ':' || v_external_id
   );

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_external_ids_list(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_external_id_upsert(uuid, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_ids_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_external_id_upsert(uuid, text, text, text, jsonb) TO authenticated;
