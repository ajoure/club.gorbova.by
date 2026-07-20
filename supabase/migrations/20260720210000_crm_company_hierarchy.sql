-- Companies Phase 10C/10D: auditable company-to-company hierarchy.

CREATE TABLE IF NOT EXISTS public.company_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  from_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  to_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('parent','subsidiary','branch','representative_office','group_member','franchisee','partner')),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_relationships_not_self CHECK (from_company_id <> to_company_id),
  CONSTRAINT company_relationships_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT company_relationships_active_uniq UNIQUE (from_company_id, to_company_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS company_relationships_from_idx ON public.company_relationships(from_company_id, is_current, relationship_type);
CREATE INDEX IF NOT EXISTS company_relationships_to_idx ON public.company_relationships(to_company_id, is_current, relationship_type);
ALTER TABLE public.company_relationships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_relationships FROM anon, authenticated;
GRANT SELECT ON public.company_relationships TO authenticated;
GRANT ALL ON public.company_relationships TO service_role;

DROP POLICY IF EXISTS company_relationships_staff_read ON public.company_relationships;
CREATE POLICY company_relationships_staff_read ON public.company_relationships
FOR SELECT TO authenticated USING (
  has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin')
  OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support')
);

CREATE OR REPLACE FUNCTION public.crm_company_relationship_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_cycle boolean;
BEGIN
  IF NEW.from_company_id = NEW.to_company_id THEN RAISE EXCEPTION 'relationship_self_link' USING ERRCODE='22023'; END IF;
  IF NEW.valid_to IS NOT NULL AND NEW.valid_to < NEW.valid_from THEN RAISE EXCEPTION 'relationship_invalid_dates' USING ERRCODE='22023'; END IF;
  IF NOT NEW.is_current THEN RETURN NEW; END IF;
  WITH RECURSIVE reach(id, path) AS (
    SELECT NEW.to_company_id, ARRAY[NEW.to_company_id]::uuid[]
    UNION ALL
    SELECT r.to_company_id, reach.path || r.to_company_id
      FROM public.company_relationships r
      JOIN reach ON reach.id = r.from_company_id
     WHERE r.is_current AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND NOT r.to_company_id = ANY(reach.path)
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE id = NEW.from_company_id) INTO v_cycle;
  IF v_cycle THEN RAISE EXCEPTION 'relationship_cycle' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_company_relationships_guard ON public.company_relationships;
CREATE TRIGGER trg_company_relationships_guard
BEFORE INSERT OR UPDATE ON public.company_relationships
FOR EACH ROW EXECUTE FUNCTION public.crm_company_relationship_guard();

CREATE OR REPLACE FUNCTION public.crm_company_relationship_upsert(
  _from_company_id uuid,
  _to_company_id uuid,
  _relationship_type text,
  _valid_from date DEFAULT current_date,
  _valid_to date DEFAULT NULL,
  _is_current boolean DEFAULT true,
  _source text DEFAULT 'manual',
  _evidence jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_workspace uuid;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _relationship_type NOT IN ('parent','subsidiary','branch','representative_office','group_member','franchisee','partner') THEN RAISE EXCEPTION 'invalid_relationship_type' USING ERRCODE='22023'; END IF;
  IF _source NOT IN ('manual','import','document_review','integration','billing_requisites') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;
  SELECT c.workspace_id INTO v_workspace FROM public.companies c WHERE c.id = _from_company_id AND c.status <> 'merged';
  IF v_workspace IS NULL THEN RAISE EXCEPTION 'from_company_not_found' USING ERRCODE='23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _to_company_id AND c.workspace_id = v_workspace AND c.status <> 'merged') THEN RAISE EXCEPTION 'to_company_not_found' USING ERRCODE='23503'; END IF;

  INSERT INTO public.company_relationships(workspace_id, from_company_id, to_company_id, relationship_type, valid_from, valid_to, is_current, source, evidence, metadata, created_by, updated_by)
  VALUES (v_workspace, _from_company_id, _to_company_id, _relationship_type, coalesce(_valid_from,current_date), _valid_to, coalesce(_is_current,true), _source, coalesce(_evidence,'{}'::jsonb), coalesce(_metadata,'{}'::jsonb), v_uid, v_uid)
  ON CONFLICT (from_company_id, to_company_id, relationship_type) DO UPDATE SET valid_from=excluded.valid_from, valid_to=excluded.valid_to, is_current=excluded.is_current, source=excluded.source, evidence=excluded.evidence, metadata=excluded.metadata, updated_by=v_uid, updated_at=now()
  RETURNING id INTO v_id;

  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type, user_id, idempotency_key, title_snapshot, text_snapshot, metadata)
  VALUES ('company.relationship.updated', _from_company_id, 'company', v_uid, 'company.relationship.updated:' || v_id::text || ':' || coalesce(_is_current::text,'true'), 'Связь компаний обновлена', _relationship_type, jsonb_build_object('relationship_id',v_id,'to_company_id',_to_company_id,'source',_source))
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_company_relationships_list(_company_id uuid, _include_history boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'direction', CASE WHEN r.from_company_id=_company_id THEN 'outgoing' ELSE 'incoming' END, 'from_company_id', r.from_company_id, 'to_company_id', r.to_company_id, 'related_company_id', CASE WHEN r.from_company_id=_company_id THEN r.to_company_id ELSE r.from_company_id END, 'relationship_type', r.relationship_type, 'valid_from', r.valid_from, 'valid_to', r.valid_to, 'is_current', r.is_current, 'source', r.source, 'evidence', r.evidence, 'metadata', r.metadata, 'updated_at', r.updated_at) ORDER BY r.is_current DESC, r.relationship_type, r.created_at DESC), '[]'::jsonb)
    INTO v_result FROM public.company_relationships r
   WHERE (r.from_company_id=_company_id OR r.to_company_id=_company_id)
     AND (_include_history OR r.is_current);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_relationship_upsert(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_relationships_list(uuid,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_relationship_upsert(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_relationships_list(uuid,boolean) TO authenticated;
