-- Phase 5B — Company ↔ Order/Deal and Company ↔ Task links
CREATE TABLE IF NOT EXISTS public.company_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  relationship_role text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_client_legal_details_id uuid REFERENCES public.client_legal_details(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz, unlinked_by uuid, unlink_reason text,
  CONSTRAINT company_order_links_role_chk CHECK (relationship_role IN ('customer','payer','beneficiary','contract_party','employer','partner')),
  CONSTRAINT company_order_links_source_chk CHECK (source IN ('manual','billing_requisites','migration','integration')),
  CONSTRAINT company_order_links_manual_lineage_chk CHECK (source <> 'manual' OR source_client_legal_details_id IS NULL),
  CONSTRAINT company_order_links_unlink_audit_chk CHECK (unlinked_at IS NULL OR (unlinked_by IS NOT NULL AND length(trim(coalesce(unlink_reason,''))) >= 3))
);
CREATE UNIQUE INDEX IF NOT EXISTS company_order_links_active_uniq ON public.company_order_links(company_id, order_id, relationship_role) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS company_order_links_company_idx ON public.company_order_links(workspace_id, company_id, created_at DESC) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS company_order_links_order_idx ON public.company_order_links(order_id, created_at DESC) WHERE unlinked_at IS NULL;
DROP TRIGGER IF EXISTS update_company_order_links_updated_at ON public.company_order_links;
CREATE TRIGGER update_company_order_links_updated_at BEFORE UPDATE ON public.company_order_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_order_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_order_links FROM anon, authenticated;
GRANT SELECT ON public.company_order_links TO authenticated;
GRANT ALL ON public.company_order_links TO service_role;
DROP POLICY IF EXISTS company_order_links_staff_read ON public.company_order_links;
CREATE POLICY company_order_links_staff_read ON public.company_order_links FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin') OR public.has_role_v2(auth.uid(),'menedzher') OR public.has_role_v2(auth.uid(),'support'));

CREATE OR REPLACE FUNCTION public._crm_company_order_activity(_event_type text,_company_id uuid,_order_id uuid,_link_id uuid,_relationship_role text,_actor_user_id uuid,_idempotency_key text,_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _event_type NOT IN ('company.linked_to_order.v1','company.unlinked_from_order.v1') THEN RAISE EXCEPTION 'bad_company_order_event' USING ERRCODE='22023'; END IF;
  IF _actor_user_id IS NULL OR _idempotency_key IS NULL OR length(_idempotency_key)<8 THEN RAISE EXCEPTION 'bad_company_order_event_input' USING ERRCODE='22023'; END IF;
  PERFORM public._crm_company_emit_domain_event(_event_type,_company_id,_idempotency_key,jsonb_build_object('version',1,'company_id',_company_id,'order_id',_order_id,'link_id',_link_id,'relationship_role',_relationship_role,'actor_user_id',_actor_user_id,'occurred_at',now(),'idempotency_key',_idempotency_key,'metadata',coalesce(_metadata,'{}'::jsonb)));
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,metadata)
  VALUES (replace(_event_type,'.v1',''),_company_id,'company',_actor_user_id,_idempotency_key,jsonb_build_object('order_id',_order_id,'link_id',_link_id,'relationship_role',_relationship_role,'metadata',coalesce(_metadata,'{}'::jsonb)))
  ON CONFLICT (idempotency_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_link_order(_company_id uuid,_order_id uuid,_relationship_role text,_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_company public.companies%ROWTYPE; v_link public.company_order_links%ROWTYPE; v_role text := lower(trim(coalesce(_relationship_role,''))); v_key text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(v_actor,'admin') OR public.has_role_v2(v_actor,'super_admin') OR public.has_role_v2(v_actor,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('customer','payer','beneficiary','contract_party','employer','partner') THEN RAISE EXCEPTION 'invalid_relationship_role' USING ERRCODE='22023'; END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN RAISE EXCEPTION 'invalid_metadata' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_company FROM public.companies WHERE id=_company_id FOR UPDATE;
  IF v_company.id IS NULL OR v_company.status <> 'active' THEN RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.orders_v2 WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_link FROM public.company_order_links WHERE company_id=_company_id AND order_id=_order_id AND relationship_role=v_role AND unlinked_at IS NULL FOR UPDATE;
  IF v_link.id IS NOT NULL THEN RETURN v_link.id; END IF;
  INSERT INTO public.company_order_links(workspace_id,company_id,order_id,relationship_role,source,metadata,created_by,updated_by)
  VALUES (v_company.workspace_id,_company_id,_order_id,v_role,'manual',_metadata,v_actor,v_actor) RETURNING * INTO v_link;
  v_key := 'company.linked_to_order:' || v_link.id::text;
  PERFORM public._crm_company_order_activity('company.linked_to_order.v1',_company_id,_order_id,v_link.id,v_role,v_actor,v_key,_metadata);
  RETURN v_link.id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_unlink_order(_link_id uuid,_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_link public.company_order_links%ROWTYPE; v_reason text := trim(coalesce(_reason,'')); v_key text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(v_actor,'admin') OR public.has_role_v2(v_actor,'super_admin') OR public.has_role_v2(v_actor,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF length(v_reason)<3 OR length(v_reason)>500 THEN RAISE EXCEPTION 'invalid_reason' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_link FROM public.company_order_links WHERE id=_link_id FOR UPDATE;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'company_order_link_not_found' USING ERRCODE='23503'; END IF;
  IF v_link.unlinked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.company_order_links SET unlinked_at=now(), unlinked_by=v_actor, unlink_reason=v_reason, updated_by=v_actor WHERE id=v_link.id;
  v_key := 'company.unlinked_from_order:' || v_link.id::text;
  PERFORM public._crm_company_order_activity('company.unlinked_from_order.v1',v_link.company_id,v_link.order_id,v_link.id,v_link.relationship_role,v_actor,v_key,jsonb_build_object('reason',v_reason));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public._crm_company_order_activity(text,uuid,uuid,uuid,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_order(uuid,uuid,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_company_unlink_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_company_link_order(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_unlink_order(uuid,text) TO authenticated;

ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_tasks_workspace_company_status_due_idx ON public.crm_tasks(workspace_id, company_id, status, due_at) WHERE company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_task_create(payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _type_key text; _type_id uuid; _type_row public.crm_task_types%ROWTYPE; _title text; _due_at timestamptz; _remind_at timestamptz; _source text; _new_id uuid; _company_id uuid; _company public.companies%ROWTYPE;
BEGIN
  PERFORM public._crm_tasks_assert_staff();
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023'; END IF;
  _title := nullif(trim(payload->>'title'),'');
  IF _title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='22023'; END IF;
  IF payload ? 'task_type_id' AND nullif(payload->>'task_type_id','') IS NOT NULL THEN
    _type_id := (payload->>'task_type_id')::uuid;
    SELECT * INTO _type_row FROM public.crm_task_types WHERE id=_type_id;
  ELSIF payload ? 'task_type' AND nullif(payload->>'task_type','') IS NOT NULL THEN
    _type_key := payload->>'task_type';
    SELECT * INTO _type_row FROM public.crm_task_types WHERE key=_type_key AND is_active=true;
  ELSE RAISE EXCEPTION 'task_type_required' USING ERRCODE='22023'; END IF;
  IF _type_row.id IS NULL THEN RAISE EXCEPTION 'task_type_not_found' USING ERRCODE='22023'; END IF;
  _company_id := nullif(payload->>'company_id','')::uuid;
  IF _company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id=_company_id;
    IF _company.id IS NULL OR _company.status <> 'active' THEN RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023'; END IF;
  END IF;
  IF payload ? 'due_at' AND nullif(payload->>'due_at','') IS NOT NULL THEN _due_at := (payload->>'due_at')::timestamptz;
  ELSIF _type_row.default_due_offset_minutes IS NOT NULL THEN _due_at := now() + make_interval(mins => _type_row.default_due_offset_minutes); END IF;
  IF payload ? 'remind_at' AND nullif(payload->>'remind_at','') IS NOT NULL THEN _remind_at := (payload->>'remind_at')::timestamptz;
  ELSIF _due_at IS NOT NULL AND _type_row.default_reminder_offset_minutes IS NOT NULL THEN _remind_at := _due_at - make_interval(mins => _type_row.default_reminder_offset_minutes); END IF;
  _source := coalesce(nullif(payload->>'source',''),'manual');
  IF _source NOT IN ('manual','auto','system') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;
  INSERT INTO public.crm_tasks(task_type_id,title,description,contact_id,company_id,deal_id,order_id,pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,assignee_user_id,due_at,remind_at,status,source,automation_rule_id,created_by,updated_by,meta)
  VALUES (_type_row.id,_title,nullif(payload->>'description',''),nullif(payload->>'contact_id','')::uuid,_company_id,nullif(payload->>'deal_id','')::uuid,nullif(payload->>'order_id','')::uuid,nullif(payload->>'pipeline_id','')::uuid,nullif(payload->>'pipeline_stage_id','')::uuid,nullif(payload->>'offer_id','')::uuid,nullif(payload->>'product_id','')::uuid,nullif(payload->>'tariff_id','')::uuid,nullif(payload->>'assignee_user_id','')::uuid,_due_at,_remind_at,coalesce(nullif(payload->>'status',''),'open'),_source,nullif(payload->>'automation_rule_id','')::uuid,_uid,_uid,coalesce(payload->'meta','{}'::jsonb)) RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_task_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_task_create(jsonb) TO authenticated, service_role;

-- Phase 5C — External IDs table + minimal RPCs used by import
CREATE TABLE IF NOT EXISTS public.company_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  external_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  CONSTRAINT company_external_ids_provider_chk CHECK (provider ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT company_external_ids_value_chk CHECK (length(btrim(external_id)) BETWEEN 1 AND 256)
);
CREATE UNIQUE INDEX IF NOT EXISTS company_external_ids_company_provider_uniq ON public.company_external_ids(company_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS company_external_ids_provider_value_uniq ON public.company_external_ids(provider, external_id);
CREATE INDEX IF NOT EXISTS company_external_ids_company_idx ON public.company_external_ids(company_id, provider);
DROP TRIGGER IF EXISTS update_company_external_ids_updated_at ON public.company_external_ids;
CREATE TRIGGER update_company_external_ids_updated_at BEFORE UPDATE ON public.company_external_ids FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_external_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_external_ids FROM anon, authenticated;
GRANT ALL ON public.company_external_ids TO service_role;

CREATE OR REPLACE FUNCTION public.crm_company_external_ids_list(_company_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.provider) FROM public.company_external_ids e WHERE e.company_id=_company_id),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.crm_company_external_ids_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_ids_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_company_external_id_upsert(_company_id uuid,_provider text,_external_id text,_external_url text DEFAULT NULL,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_provider text := lower(btrim(_provider)); v_external_id text := btrim(_external_id);
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_company_id AND c.status <> 'merged') THEN RAISE EXCEPTION 'company not found or merged' USING ERRCODE='23503'; END IF;
  IF v_provider !~ '^[a-z][a-z0-9_.-]{1,63}$' OR length(v_external_id) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid external identifier' USING ERRCODE='22023'; END IF;
  INSERT INTO public.company_external_ids(company_id,provider,external_id,external_url,metadata,created_by,updated_by)
  VALUES (_company_id,v_provider,v_external_id,NULLIF(btrim(_external_url),''),COALESCE(_metadata,'{}'::jsonb),v_uid,v_uid)
  ON CONFLICT (company_id,provider) DO UPDATE SET external_id=EXCLUDED.external_id, external_url=EXCLUDED.external_url, metadata=EXCLUDED.metadata, updated_by=v_uid, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_external_id_upsert(uuid,text,text,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_id_upsert(uuid,text,text,text,jsonb) TO authenticated;

-- Phase 5D — Contact persons registry (external LPRs, not profiles)
CREATE TABLE IF NOT EXISTS public.company_contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  job_title text,
  email text,
  phone text,
  source text NOT NULL DEFAULT 'manual',
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  CONSTRAINT company_contact_persons_full_name_chk CHECK (length(btrim(full_name)) BETWEEN 2 AND 200),
  CONSTRAINT company_contact_persons_source_chk CHECK (source IN ('manual','import','integration'))
);
CREATE INDEX IF NOT EXISTS company_contact_persons_source_key_idx ON public.company_contact_persons ((external_ids->>'source_key')) WHERE external_ids ? 'source_key';
DROP TRIGGER IF EXISTS update_company_contact_persons_updated_at ON public.company_contact_persons;
CREATE TRIGGER update_company_contact_persons_updated_at BEFORE UPDATE ON public.company_contact_persons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_contact_persons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_contact_persons FROM anon, authenticated;
GRANT ALL ON public.company_contact_persons TO service_role;

CREATE TABLE IF NOT EXISTS public.company_contact_person_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.company_contact_persons(id) ON DELETE RESTRICT,
  role text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  CONSTRAINT company_contact_person_links_role_chk CHECK (role IN ('director','accountant','founder','beneficial_owner','authorized_representative','employee','billing_contact','contract_signatory')),
  CONSTRAINT company_contact_person_links_source_chk CHECK (source IN ('manual','import','integration'))
);
CREATE UNIQUE INDEX IF NOT EXISTS company_contact_person_links_uniq ON public.company_contact_person_links(company_id, person_id, role);
CREATE INDEX IF NOT EXISTS company_contact_person_links_company_idx ON public.company_contact_person_links(company_id, role);
DROP TRIGGER IF EXISTS update_company_contact_person_links_updated_at ON public.company_contact_person_links;
CREATE TRIGGER update_company_contact_person_links_updated_at BEFORE UPDATE ON public.company_contact_person_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_contact_person_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_contact_person_links FROM anon, authenticated;
GRANT ALL ON public.company_contact_person_links TO service_role;

-- Phase 5E — Company notes
CREATE TABLE IF NOT EXISTS public.company_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, deleted_by uuid,
  CONSTRAINT company_notes_body_chk CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  CONSTRAINT company_notes_source_chk CHECK (source IN ('manual','google_sheet','import','integration','system'))
);
CREATE UNIQUE INDEX IF NOT EXISTS company_notes_source_key_uniq ON public.company_notes(source, source_key) WHERE source_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS company_notes_company_idx ON public.company_notes(company_id, created_at DESC) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS update_company_notes_updated_at ON public.company_notes;
CREATE TRIGGER update_company_notes_updated_at BEFORE UPDATE ON public.company_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_notes FROM anon, authenticated;
GRANT ALL ON public.company_notes TO service_role;

CREATE OR REPLACE FUNCTION public.company_note_create(_company_id uuid, _body text, _source text DEFAULT 'manual', _source_key text DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_body text := btrim(coalesce(_body,'')); v_source text := lower(coalesce(_source,'manual'));
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF length(v_body) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE='22023'; END IF;
  IF v_source NOT IN ('manual','google_sheet','import','integration','system') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_company_id AND c.status <> 'merged') THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='23503'; END IF;
  IF _source_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.company_notes WHERE source=v_source AND source_key=_source_key AND deleted_at IS NULL LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.company_notes(company_id,body,source,source_key,metadata,created_by,updated_by)
  VALUES (_company_id,v_body,v_source,_source_key,COALESCE(_metadata,'{}'::jsonb),v_uid,v_uid) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.company_note_create(uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_note_create(uuid,text,text,text,jsonb) TO authenticated, service_role;