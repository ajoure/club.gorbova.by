DROP TABLE IF EXISTS public.company_notes CASCADE;
DROP TABLE IF EXISTS public.company_contact_person_links CASCADE;
DROP TABLE IF EXISTS public.company_contact_persons CASCADE;
DROP FUNCTION IF EXISTS public.company_note_create(uuid,text,text,text,jsonb) CASCADE;

-- Phase 7: crm_company_update
CREATE OR REPLACE FUNCTION public.crm_company_update(_id uuid,_full_name text,_short_name text DEFAULT NULL,_email text DEFAULT NULL,_phone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row public.companies%ROWTYPE; v_full_name text := NULLIF(btrim(_full_name),''); v_short_name text := NULLIF(btrim(_short_name),''); v_email text := NULLIF(btrim(_email),''); v_phone text := NULLIF(btrim(_phone),''); v_changed jsonb;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF v_full_name IS NULL THEN RAISE EXCEPTION 'full_name required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.companies WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status='merged' THEN RAISE EXCEPTION 'merged company cannot be edited' USING ERRCODE='22023'; END IF;
  v_changed := jsonb_strip_nulls(jsonb_build_object(
    'full_name', CASE WHEN v_row.full_name IS DISTINCT FROM v_full_name THEN jsonb_build_object('from',v_row.full_name,'to',v_full_name) END,
    'short_name', CASE WHEN v_row.short_name IS DISTINCT FROM v_short_name THEN jsonb_build_object('from',v_row.short_name,'to',v_short_name) END,
    'email', CASE WHEN v_row.email IS DISTINCT FROM v_email THEN jsonb_build_object('from',v_row.email,'to',v_email) END,
    'phone', CASE WHEN v_row.phone IS DISTINCT FROM v_phone THEN jsonb_build_object('from',v_row.phone,'to',v_phone) END
  ));
  IF v_changed='{}'::jsonb THEN RETURN _id; END IF;
  UPDATE public.companies SET full_name=v_full_name, short_name=v_short_name, email=v_email, phone=v_phone, updated_at=now(), updated_by=auth.uid() WHERE id=_id;
  PERFORM public._crm_company_emit_domain_event('company.updated.v1',_id,'company.updated:'||_id::text||':'||md5(v_changed::text),jsonb_build_object('version',1,'company_id',_id,'changed_fields',v_changed,'occurred_at',now(),'actor_user_id',auth.uid()));
  INSERT INTO public.audit_logs(actor_user_id,action,actor_type,entity_type,entity_id,meta) VALUES (auth.uid(),'company.update','user','company',_id::text,jsonb_build_object('changed_fields',v_changed));
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,metadata) VALUES ('company.updated',_id,'company',auth.uid(),'company.updated:'||_id::text||':'||md5(v_changed::text),jsonb_build_object('changed_fields',v_changed)) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_update(uuid,text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_update(uuid,text,text,text,text) TO authenticated;

-- Phase 7D: crm_company_quality_summary
CREATE OR REPLACE FUNCTION public.crm_company_quality_summary() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'without_contacts', (SELECT count(*) FROM public.companies c WHERE c.status='active' AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id=c.id)),
    'without_unp', (SELECT count(*) FROM public.companies c WHERE c.status='active' AND NULLIF(btrim(c.unp_normalized),'') IS NULL),
    'without_billing_map', (SELECT count(*) FROM public.companies c WHERE c.status='active' AND NOT EXISTS (SELECT 1 FROM public.client_legal_details_company_map m WHERE m.company_id=c.id)),
    'ownership_conflicts', (SELECT count(DISTINCT source_entity_id) FROM public.crm_activity_log WHERE source_entity_type='company' AND activity_type='company.field.override_conflict'),
    'broken_merged_chain', (SELECT count(*) FROM public.companies c WHERE c.status='merged' AND (c.merged_into_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies t WHERE t.id=c.merged_into_company_id))),
    'failed_sync', (SELECT count(*) FROM public.company_sync_queue q WHERE q.status IN ('failed','dead_letter')),
    'duplicate_candidates', (SELECT count(*) FROM (SELECT c.country,c.unp_normalized FROM public.companies c WHERE c.status<>'merged' AND c.unp_normalized IS NOT NULL GROUP BY c.country,c.unp_normalized HAVING count(*)>1) d),
    'orphan_order_links', (SELECT count(*) FROM public.company_order_links l WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=l.company_id)),
    'generated_at', now()
  );
END $$;
REVOKE ALL ON FUNCTION public.crm_company_quality_summary() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_quality_summary() TO authenticated;

-- Phase 7C: crm_company_restore
CREATE OR REPLACE FUNCTION public.crm_company_restore(_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row public.companies%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.companies WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status='merged' THEN RAISE EXCEPTION 'merged company cannot be restored' USING ERRCODE='22023'; END IF;
  IF v_row.status='active' THEN RETURN _id; END IF;
  UPDATE public.companies SET status='active', archived_at=NULL, updated_at=now(), updated_by=auth.uid() WHERE id=_id;
  PERFORM public._crm_company_emit_domain_event('company.restored.v1',_id,'company.restored:'||_id::text,jsonb_build_object('version',1,'company_id',_id,'occurred_at',now(),'actor_user_id',auth.uid()));
  INSERT INTO public.audit_logs(actor_user_id,action,actor_type,entity_type,entity_id,meta) VALUES (auth.uid(),'company.restore','user','company',_id::text,'{}'::jsonb);
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,metadata) VALUES ('company.restored',_id,'company',auth.uid(),'company.restored:'||_id::text,'{}'::jsonb) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_restore(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_restore(uuid) TO authenticated;

-- Phase 8A: document compatibility
ALTER TABLE public.generated_documents ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.ai_generated_documents ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_generated_documents_company ON public.generated_documents(company_id, document_date DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_generated_documents_company ON public.ai_generated_documents(company_id, created_at DESC) WHERE company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_generated_document_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company_id uuid;
BEGIN
  IF NEW.company_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT min(company_id) INTO v_company_id FROM public.company_order_links WHERE order_id=NEW.order_id AND unlinked_at IS NULL HAVING count(DISTINCT company_id)=1;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_ai_generated_document_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company_id uuid;
BEGIN
  IF NEW.company_id IS NULL AND NEW.context_type IN ('order','deal') AND NEW.context_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT min(company_id) INTO v_company_id FROM public.company_order_links WHERE order_id=NEW.context_id::uuid AND unlinked_at IS NULL HAVING count(DISTINCT company_id)=1;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resolve_generated_document_company ON public.generated_documents;
CREATE TRIGGER trg_resolve_generated_document_company BEFORE INSERT ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public.resolve_generated_document_company();
DROP TRIGGER IF EXISTS trg_resolve_ai_generated_document_company ON public.ai_generated_documents;
CREATE TRIGGER trg_resolve_ai_generated_document_company BEFORE INSERT ON public.ai_generated_documents FOR EACH ROW EXECUTE FUNCTION public.resolve_ai_generated_document_company();

-- Phase 8B: document placeholders
INSERT INTO public.document_token_registry (token_key, ui_label, description, category, source_type, resolver_key, is_required, display_order) VALUES
  ('company.full_name','Компания: полное название','Полное юридическое название компании','company','system','company.full_name',false,60),
  ('company.short_name','Компания: краткое название','Краткое название компании','company','system','company.short_name',false,61),
  ('company.unp','Компания: УНП','Нормализованный УНП компании','company','system','company.unp',false,62),
  ('company.legal_address','Компания: юридический адрес','Юридический адрес компании','company','system','company.legal_address',false,63),
  ('company.director.name','Компания: директор','ФИО руководителя компании','company','system','company.director.name',false,64),
  ('company.director.position','Компания: должность директора','Должность руководителя компании','company','system','company.director.position',false,65),
  ('company.bank.account','Компания: расчётный счёт','Расчётный счёт компании','company','system','company.bank.account',false,66),
  ('company.bank.name','Компания: банк','Название банка компании','company','system','company.bank.name',false,67),
  ('company.public_id','Компания: публичный ID','Стабильный CRM ID компании','company','system','company.public_id',false,68)
ON CONFLICT (token_key) DO NOTHING;

-- Phase 8C: crm_company_create_from_billing
CREATE OR REPLACE FUNCTION public.crm_company_create_from_billing(_client_legal_details_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_legal_details cld WHERE cld.id=_client_legal_details_id AND cld.purpose='billing' AND cld.client_type IN ('legal_entity','entrepreneur')) THEN RAISE EXCEPTION 'billing legal details not found' USING ERRCODE='23503'; END IF;
  v_id := public.crm_company_upsert_from_billing(_client_legal_details_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_create_from_billing(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_create_from_billing(uuid) TO authenticated;

-- Phase 9A: external_ids
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

CREATE OR REPLACE FUNCTION public.crm_company_external_ids_list(_company_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.provider) FROM public.company_external_ids e WHERE e.company_id=_company_id),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_external_id_upsert(_company_id uuid,_provider text,_external_id text,_external_url text DEFAULT NULL,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_provider text := lower(btrim(_provider)); v_external_id text := btrim(_external_id);
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_company_id AND c.status<>'merged') THEN RAISE EXCEPTION 'company not found or merged' USING ERRCODE='23503'; END IF;
  IF v_provider !~ '^[a-z][a-z0-9_.-]{1,63}$' OR length(v_external_id) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid external identifier' USING ERRCODE='22023'; END IF;
  INSERT INTO public.company_external_ids(company_id,provider,external_id,external_url,metadata,created_by,updated_by)
  VALUES (_company_id,v_provider,v_external_id,NULLIF(btrim(_external_url),''),COALESCE(_metadata,'{}'::jsonb),v_uid,v_uid)
  ON CONFLICT (company_id,provider) DO UPDATE SET external_id=EXCLUDED.external_id, external_url=EXCLUDED.external_url, metadata=EXCLUDED.metadata, updated_by=v_uid, updated_at=now()
  RETURNING id INTO v_id;
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,title_snapshot,text_snapshot,metadata)
  SELECT 'company.external_id.updated',_company_id,'company',v_uid,'company.external_id.updated:'||v_id::text||':'||v_external_id,'Внешний идентификатор обновлён',v_provider||': '||v_external_id,jsonb_build_object('provider',v_provider,'external_id',v_external_id)
   WHERE NOT EXISTS (SELECT 1 FROM public.crm_activity_log a WHERE a.idempotency_key='company.external_id.updated:'||v_id::text||':'||v_external_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_external_ids_list(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_external_id_upsert(uuid,text,text,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_ids_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_external_id_upsert(uuid,text,text,text,jsonb) TO authenticated;

-- Phase 9C: reconcile preview
CREATE OR REPLACE FUNCTION public.crm_company_external_reconcile_preview(_provider text,_rows jsonb,_limit integer DEFAULT 1000) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_provider text := lower(btrim(_provider)); v_item jsonb; v_index bigint; v_external_id text; v_country text; v_unp text; v_email text; v_phone text; v_company_id uuid; v_candidates jsonb; v_candidate_count integer; v_action text; v_reason text; v_results jsonb := '[]'::jsonb; v_counts jsonb := jsonb_build_object('total',0,'create',0,'link_candidate',0,'existing',0,'conflict',0,'skip',0); v_limit integer := least(greatest(coalesce(_limit,1000),1),5000);
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF v_provider !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN RAISE EXCEPTION 'invalid provider' USING ERRCODE='22023'; END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows)<>'array' THEN RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE='22023'; END IF;
  FOR v_item, v_index IN SELECT value, ordinality FROM jsonb_array_elements(_rows) WITH ORDINALITY LIMIT v_limit LOOP
    v_external_id := btrim(coalesce(v_item->>'externalId',v_item->>'external_id',''));
    v_country := upper(btrim(coalesce(v_item->>'country','BY')));
    v_unp := regexp_replace(btrim(coalesce(v_item->>'unp','')),'\s+','','g');
    v_email := lower(btrim(coalesce(v_item->>'email','')));
    v_phone := regexp_replace(btrim(coalesce(v_item->>'phone','')),'[^0-9+]','','g');
    v_company_id := NULL; v_candidates := '[]'::jsonb; v_candidate_count := 0; v_action := 'create'; v_reason := 'Нет точного совпадения: требуется создание или ручная привязка.';
    IF v_external_id='' OR length(v_external_id)>256 THEN v_action:='skip'; v_reason:='Отсутствует или слишком длинный внешний ID.';
    ELSE
      SELECT e.company_id INTO v_company_id FROM public.company_external_ids e WHERE e.provider=v_provider AND e.external_id=v_external_id LIMIT 1;
      IF v_company_id IS NOT NULL THEN v_action:='existing'; v_reason:='Внешний ID уже привязан к canonical company.'; v_candidates:=jsonb_build_array(jsonb_build_object('company_id',v_company_id)); v_candidate_count:=1;
      ELSE
        SELECT coalesce(jsonb_agg(jsonb_build_object('company_id',c.id,'public_id',c.public_id,'full_name',c.full_name) ORDER BY c.public_id),'[]'::jsonb) INTO v_candidates FROM public.companies c
         WHERE c.status='active' AND ((length(v_unp)=9 AND c.country=v_country AND c.unp_normalized=v_unp) OR (v_unp='' AND v_email<>'' AND lower(coalesce(c.email,''))=v_email) OR (v_unp='' AND v_phone<>'' AND regexp_replace(coalesce(c.phone,''),'[^0-9+]','','g')=v_phone));
        SELECT jsonb_array_length(v_candidates) INTO v_candidate_count;
        IF v_candidate_count=1 THEN v_action:='link_candidate'; v_reason:='Найдено ровно одно детерминированное совпадение; привязка требует подтверждения импорта.';
        ELSIF v_candidate_count>1 THEN v_action:='conflict'; v_reason:='Найдено несколько canonical companies; автоматическая привязка запрещена.'; END IF;
      END IF;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('source_row',v_index,'external_id',NULLIF(v_external_id,''),'action',v_action,'reason',v_reason,'candidates',v_candidates));
    v_counts := jsonb_set(v_counts, ARRAY['total'], to_jsonb((v_counts->>'total')::integer+1));
    v_counts := jsonb_set(v_counts, ARRAY[v_action], to_jsonb(coalesce((v_counts->>v_action)::integer,0)+1));
  END LOOP;
  RETURN jsonb_build_object('provider',v_provider,'limited',jsonb_array_length(_rows)>v_limit,'counts',v_counts,'rows',v_results);
END $$;
REVOKE ALL ON FUNCTION public.crm_company_external_reconcile_preview(text,jsonb,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_reconcile_preview(text,jsonb,integer) TO authenticated;

-- Phase 10A: contact persons registry
CREATE TABLE IF NOT EXISTS public.company_contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 256),
  job_title text, email text, phone text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  consent_status text NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','pending','granted','denied')),
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS company_contact_persons_profile_uniq ON public.company_contact_persons(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_contact_persons_email_idx ON public.company_contact_persons(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_contact_persons_phone_idx ON public.company_contact_persons(phone) WHERE phone IS NOT NULL;
DROP TRIGGER IF EXISTS update_company_contact_persons_updated_at ON public.company_contact_persons;
CREATE TRIGGER update_company_contact_persons_updated_at BEFORE UPDATE ON public.company_contact_persons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.company_contact_person_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.company_contact_persons(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('director','accountant','founder','beneficial_owner','authorized_representative','employee','billing_contact','contract_signatory')),
  valid_from date NOT NULL DEFAULT current_date, valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  CONSTRAINT company_contact_person_links_dates_chk CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT company_contact_person_links_unique_role UNIQUE (company_id, person_id, role)
);
CREATE INDEX IF NOT EXISTS company_contact_person_links_company_idx ON public.company_contact_person_links(company_id, is_current, role);
CREATE INDEX IF NOT EXISTS company_contact_person_links_person_idx ON public.company_contact_person_links(person_id, is_current);
DROP TRIGGER IF EXISTS update_company_contact_person_links_updated_at ON public.company_contact_person_links;
CREATE TRIGGER update_company_contact_person_links_updated_at BEFORE UPDATE ON public.company_contact_person_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.company_contact_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contact_person_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company contact persons read for CRM staff" ON public.company_contact_persons;
CREATE POLICY "company contact persons read for CRM staff" ON public.company_contact_persons FOR SELECT TO authenticated USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support'));
DROP POLICY IF EXISTS "company contact persons write for admin+manager" ON public.company_contact_persons;
CREATE POLICY "company contact persons write for admin+manager" ON public.company_contact_persons FOR ALL TO authenticated USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher')) WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'));
DROP POLICY IF EXISTS "company contact person links read for CRM staff" ON public.company_contact_person_links;
CREATE POLICY "company contact person links read for CRM staff" ON public.company_contact_person_links FOR SELECT TO authenticated USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support'));
DROP POLICY IF EXISTS "company contact person links write for admin+manager" ON public.company_contact_person_links;
CREATE POLICY "company contact person links write for admin+manager" ON public.company_contact_person_links FOR ALL TO authenticated USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher')) WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'));

CREATE OR REPLACE FUNCTION public.crm_company_contact_person_upsert(_person_id uuid DEFAULT NULL,_full_name text DEFAULT NULL,_job_title text DEFAULT NULL,_email text DEFAULT NULL,_phone text DEFAULT NULL,_source text DEFAULT 'manual',_profile_id uuid DEFAULT NULL,_consent_status text DEFAULT 'unknown',_external_ids jsonb DEFAULT '{}'::jsonb,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid := _person_id;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'full_name is required' USING ERRCODE='22023'; END IF;
  IF _source NOT IN ('manual','import','document_review','integration','billing_requisites') THEN RAISE EXCEPTION 'invalid source' USING ERRCODE='22023'; END IF;
  IF _consent_status NOT IN ('unknown','pending','granted','denied') THEN RAISE EXCEPTION 'invalid consent status' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.company_contact_persons(full_name,job_title,email,phone,source,profile_id,consent_status,external_ids,metadata,created_by,updated_by)
    VALUES (btrim(_full_name), NULLIF(btrim(_job_title),''), NULLIF(lower(btrim(_email)),''), NULLIF(btrim(_phone),''), _source, _profile_id, _consent_status, coalesce(_external_ids,'{}'::jsonb), coalesce(_metadata,'{}'::jsonb), v_uid, v_uid) RETURNING id INTO v_id;
  ELSE
    UPDATE public.company_contact_persons SET full_name=btrim(_full_name), job_title=NULLIF(btrim(_job_title),''), email=NULLIF(lower(btrim(_email)),''), phone=NULLIF(btrim(_phone),''), source=_source, profile_id=_profile_id, consent_status=_consent_status, external_ids=coalesce(_external_ids,'{}'::jsonb), metadata=coalesce(_metadata,'{}'::jsonb), updated_by=v_uid WHERE id=v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact person not found' USING ERRCODE='23503'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_contact_person_link(_company_id uuid,_person_id uuid,_role text,_valid_from date DEFAULT current_date,_valid_to date DEFAULT NULL,_is_current boolean DEFAULT true,_source text DEFAULT 'manual',_evidence jsonb DEFAULT '{}'::jsonb,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_company_id AND c.status<>'merged') THEN RAISE EXCEPTION 'company not found or merged' USING ERRCODE='23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_contact_persons p WHERE p.id=_person_id) THEN RAISE EXCEPTION 'contact person not found' USING ERRCODE='23503'; END IF;
  INSERT INTO public.company_contact_person_links(company_id,person_id,role,valid_from,valid_to,is_current,source,evidence,metadata,created_by,updated_by)
  VALUES (_company_id,_person_id,_role,coalesce(_valid_from,current_date),_valid_to,coalesce(_is_current,true),_source,coalesce(_evidence,'{}'::jsonb),coalesce(_metadata,'{}'::jsonb),v_uid,v_uid)
  ON CONFLICT (company_id,person_id,role) DO UPDATE SET valid_from=excluded.valid_from, valid_to=excluded.valid_to, is_current=excluded.is_current, source=excluded.source, evidence=excluded.evidence, metadata=excluded.metadata, updated_by=v_uid, updated_at=now()
  RETURNING id INTO v_id;
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,title_snapshot,text_snapshot,metadata)
  SELECT 'company.contact_person.linked',_company_id,'company',v_uid,'company.contact_person.linked:'||v_id::text||':'||_role||':'||coalesce(_is_current::text,'true'),'Контактное лицо компании обновлено',_role,jsonb_build_object('person_id',_person_id,'role',_role,'is_current',coalesce(_is_current,true))
   WHERE NOT EXISTS (SELECT 1 FROM public.crm_activity_log a WHERE a.idempotency_key='company.contact_person.linked:'||v_id::text||':'||_role||':'||coalesce(_is_current::text,'true'));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_contact_persons_list(_company_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('link_id',l.id,'person_id',p.id,'profile_id',p.profile_id,'full_name',p.full_name,'job_title',p.job_title,'email',p.email,'phone',p.phone,'role',l.role,'valid_from',l.valid_from,'valid_to',l.valid_to,'is_current',l.is_current,'source',l.source,'consent_status',p.consent_status,'external_ids',p.external_ids,'evidence',l.evidence,'updated_at',l.updated_at) ORDER BY l.is_current DESC, p.full_name),'[]'::jsonb) INTO v_result
    FROM public.company_contact_person_links l JOIN public.company_contact_persons p ON p.id=l.person_id
    WHERE l.company_id=_company_id;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_contact_person_upsert(uuid,text,text,text,text,text,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_contact_person_link(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_contact_persons_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_person_upsert(uuid,text,text,text,text,text,uuid,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_person_link(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_persons_list(uuid) TO authenticated;

-- Phase 10D: company_notes
CREATE TABLE IF NOT EXISTS public.company_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_notes_company_created ON public.company_notes(company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_notes_source_key ON public.company_notes(company_id, source, source_key) WHERE source_key IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_notes TO authenticated;
GRANT ALL ON public.company_notes TO service_role;
ALTER TABLE public.company_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_notes_staff_read" ON public.company_notes;
CREATE POLICY "company_notes_staff_read" ON public.company_notes FOR SELECT TO authenticated USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS "company_notes_staff_insert" ON public.company_notes;
CREATE POLICY "company_notes_staff_insert" ON public.company_notes FOR INSERT TO authenticated WITH CHECK (author_id=auth.uid() AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));
DROP POLICY IF EXISTS "company_notes_owner_or_admin_update" ON public.company_notes;
CREATE POLICY "company_notes_owner_or_admin_update" ON public.company_notes FOR UPDATE TO authenticated USING (author_id=auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')) WITH CHECK (author_id=auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS "company_notes_owner_or_admin_delete" ON public.company_notes;
CREATE POLICY "company_notes_owner_or_admin_delete" ON public.company_notes FOR DELETE TO authenticated USING (author_id=auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.company_notes_touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_company_notes_updated_at ON public.company_notes;
CREATE TRIGGER trg_company_notes_updated_at BEFORE UPDATE ON public.company_notes FOR EACH ROW EXECUTE FUNCTION public.company_notes_touch_updated_at();

CREATE OR REPLACE FUNCTION public.company_note_create(_company_id uuid,_body text,_source text DEFAULT 'manual',_source_key text DEFAULT NULL,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_source text := COALESCE(NULLIF(btrim(_source),''),'manual');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(v_uid,'employee') OR public.has_role_v2(v_uid,'admin') OR public.has_role_v2(v_uid,'super_admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_company_id) THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='22023'; END IF;
  IF _body IS NULL OR length(btrim(_body))=0 THEN RAISE EXCEPTION 'empty_body' USING ERRCODE='22023'; END IF;
  IF _source_key IS NOT NULL AND length(btrim(_source_key))>0 THEN
    SELECT n.id INTO v_id FROM public.company_notes n WHERE n.company_id=_company_id AND n.source=v_source AND n.source_key=btrim(_source_key) LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.company_notes(company_id,author_id,body,source,source_key,metadata) VALUES (_company_id,v_uid,btrim(_body),v_source,NULLIF(btrim(_source_key),''),COALESCE(_metadata,'{}'::jsonb)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.company_note_create(uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_note_create(uuid,text,text,text,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.company_note_delete(_note_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_author uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT n.author_id INTO v_author FROM public.company_notes n WHERE n.id=_note_id;
  IF v_author IS NULL THEN RETURN false; END IF;
  IF v_author<>v_uid AND NOT public.has_role_v2(v_uid,'admin') AND NOT public.has_role_v2(v_uid,'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  DELETE FROM public.company_notes WHERE id=_note_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.company_note_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_note_delete(uuid) TO authenticated, service_role;

-- Phase 10C: company_relationships
CREATE TABLE IF NOT EXISTS public.company_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  from_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  to_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('parent','subsidiary','branch','representative_office','group_member','franchisee','partner')),
  valid_from date NOT NULL DEFAULT current_date, valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_relationships_not_self CHECK (from_company_id<>to_company_id),
  CONSTRAINT company_relationships_dates CHECK (valid_to IS NULL OR valid_to>=valid_from),
  CONSTRAINT company_relationships_active_uniq UNIQUE (from_company_id, to_company_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS company_relationships_from_idx ON public.company_relationships(from_company_id, is_current, relationship_type);
CREATE INDEX IF NOT EXISTS company_relationships_to_idx ON public.company_relationships(to_company_id, is_current, relationship_type);
ALTER TABLE public.company_relationships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_relationships FROM anon, authenticated;
GRANT SELECT ON public.company_relationships TO authenticated;
GRANT ALL ON public.company_relationships TO service_role;
DROP POLICY IF EXISTS company_relationships_staff_read ON public.company_relationships;
CREATE POLICY company_relationships_staff_read ON public.company_relationships FOR SELECT TO authenticated USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support'));

CREATE OR REPLACE FUNCTION public.crm_company_relationship_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cycle boolean;
BEGIN
  IF NEW.from_company_id=NEW.to_company_id THEN RAISE EXCEPTION 'relationship_self_link' USING ERRCODE='22023'; END IF;
  IF NEW.valid_to IS NOT NULL AND NEW.valid_to<NEW.valid_from THEN RAISE EXCEPTION 'relationship_invalid_dates' USING ERRCODE='22023'; END IF;
  IF NOT NEW.is_current THEN RETURN NEW; END IF;
  WITH RECURSIVE reach(id,path) AS (
    SELECT NEW.to_company_id, ARRAY[NEW.to_company_id]::uuid[]
    UNION ALL
    SELECT r.to_company_id, reach.path||r.to_company_id FROM public.company_relationships r JOIN reach ON reach.id=r.from_company_id
     WHERE r.is_current AND r.id<>COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid) AND NOT r.to_company_id=ANY(reach.path)
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE id=NEW.from_company_id) INTO v_cycle;
  IF v_cycle THEN RAISE EXCEPTION 'relationship_cycle' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_company_relationships_guard ON public.company_relationships;
CREATE TRIGGER trg_company_relationships_guard BEFORE INSERT OR UPDATE ON public.company_relationships FOR EACH ROW EXECUTE FUNCTION public.crm_company_relationship_guard();

CREATE OR REPLACE FUNCTION public.crm_company_relationship_upsert(_from_company_id uuid,_to_company_id uuid,_relationship_type text,_valid_from date DEFAULT current_date,_valid_to date DEFAULT NULL,_is_current boolean DEFAULT true,_source text DEFAULT 'manual',_evidence jsonb DEFAULT '{}'::jsonb,_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_workspace uuid;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _relationship_type NOT IN ('parent','subsidiary','branch','representative_office','group_member','franchisee','partner') THEN RAISE EXCEPTION 'invalid_relationship_type' USING ERRCODE='22023'; END IF;
  IF _source NOT IN ('manual','import','document_review','integration','billing_requisites') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;
  SELECT c.workspace_id INTO v_workspace FROM public.companies c WHERE c.id=_from_company_id AND c.status<>'merged';
  IF v_workspace IS NULL THEN RAISE EXCEPTION 'from_company_not_found' USING ERRCODE='23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=_to_company_id AND c.workspace_id=v_workspace AND c.status<>'merged') THEN RAISE EXCEPTION 'to_company_not_found' USING ERRCODE='23503'; END IF;
  INSERT INTO public.company_relationships(workspace_id,from_company_id,to_company_id,relationship_type,valid_from,valid_to,is_current,source,evidence,metadata,created_by,updated_by)
  VALUES (v_workspace,_from_company_id,_to_company_id,_relationship_type,coalesce(_valid_from,current_date),_valid_to,coalesce(_is_current,true),_source,coalesce(_evidence,'{}'::jsonb),coalesce(_metadata,'{}'::jsonb),v_uid,v_uid)
  ON CONFLICT (from_company_id,to_company_id,relationship_type) DO UPDATE SET valid_from=excluded.valid_from, valid_to=excluded.valid_to, is_current=excluded.is_current, source=excluded.source, evidence=excluded.evidence, metadata=excluded.metadata, updated_by=v_uid, updated_at=now()
  RETURNING id INTO v_id;
  INSERT INTO public.crm_activity_log(activity_type,source_entity_id,source_entity_type,user_id,idempotency_key,title_snapshot,text_snapshot,metadata)
  VALUES ('company.relationship.updated',_from_company_id,'company',v_uid,'company.relationship.updated:'||v_id::text||':'||coalesce(_is_current::text,'true'),'Связь компаний обновлена',_relationship_type,jsonb_build_object('relationship_id',v_id,'to_company_id',_to_company_id,'source',_source))
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_relationships_list(_company_id uuid,_include_history boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'direction',CASE WHEN r.from_company_id=_company_id THEN 'outgoing' ELSE 'incoming' END,'from_company_id',r.from_company_id,'to_company_id',r.to_company_id,'related_company_id',CASE WHEN r.from_company_id=_company_id THEN r.to_company_id ELSE r.from_company_id END,'relationship_type',r.relationship_type,'valid_from',r.valid_from,'valid_to',r.valid_to,'is_current',r.is_current,'source',r.source,'evidence',r.evidence,'metadata',r.metadata,'updated_at',r.updated_at) ORDER BY r.is_current DESC, r.relationship_type, r.created_at DESC),'[]'::jsonb) INTO v_result
    FROM public.company_relationships r
    WHERE (r.from_company_id=_company_id OR r.to_company_id=_company_id) AND (_include_history OR r.is_current);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_relationship_upsert(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_relationships_list(uuid,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_relationship_upsert(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_relationships_list(uuid,boolean) TO authenticated;

-- Phase 11C: invariants report
CREATE OR REPLACE FUNCTION public.crm_company_invariants_report() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_duplicate_unp bigint; v_broken_merges bigint; v_orphan_tasks bigint; v_import_errors bigint; v_relationships bigint; v_result jsonb;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_duplicate_unp FROM (SELECT country,unp_normalized FROM public.companies WHERE status<>'merged' AND unp_normalized IS NOT NULL GROUP BY country,unp_normalized HAVING count(*)>1) d;
  SELECT count(*) INTO v_broken_merges FROM public.companies c WHERE c.status='merged' AND (c.merged_into_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies t WHERE t.id=c.merged_into_company_id AND t.status<>'merged'));
  SELECT count(*) INTO v_orphan_tasks FROM public.crm_tasks t WHERE t.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=t.company_id);
  SELECT count(*) INTO v_import_errors FROM public.company_import_ledger l WHERE l.status IN ('error','conflict');
  SELECT count(*) INTO v_relationships FROM public.company_relationships r WHERE r.is_current AND (NOT EXISTS (SELECT 1 FROM public.companies a WHERE a.id=r.from_company_id AND a.status<>'merged') OR NOT EXISTS (SELECT 1 FROM public.companies b WHERE b.id=r.to_company_id AND b.status<>'merged'));
  SELECT jsonb_build_object('ok',(v_duplicate_unp+v_broken_merges+v_orphan_tasks+v_import_errors+v_relationships)=0,'generated_at',now(),'checks',jsonb_build_object(
    'active_duplicate_country_unp',jsonb_build_object('status',CASE WHEN v_duplicate_unp=0 THEN 'ok' ELSE 'fail' END,'count',v_duplicate_unp),
    'broken_merged_chain',jsonb_build_object('status',CASE WHEN v_broken_merges=0 THEN 'ok' ELSE 'fail' END,'count',v_broken_merges),
    'orphan_company_tasks',jsonb_build_object('status',CASE WHEN v_orphan_tasks=0 THEN 'ok' ELSE 'fail' END,'count',v_orphan_tasks),
    'company_import_conflicts_or_errors',jsonb_build_object('status',CASE WHEN v_import_errors=0 THEN 'ok' ELSE 'attention' END,'count',v_import_errors),
    'inactive_company_relationships',jsonb_build_object('status',CASE WHEN v_relationships=0 THEN 'ok' ELSE 'fail' END,'count',v_relationships)
  )) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.crm_company_invariants_report() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_invariants_report() TO authenticated;

-- Company files
CREATE TABLE IF NOT EXISTS public.company_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  url text, mime_type text, size_bytes bigint,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_files_company_created ON public.company_files(company_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_files TO authenticated;
GRANT ALL ON public.company_files TO service_role;
ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_files_staff_read" ON public.company_files;
CREATE POLICY "company_files_staff_read" ON public.company_files FOR SELECT TO authenticated USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS "company_files_staff_insert" ON public.company_files;
CREATE POLICY "company_files_staff_insert" ON public.company_files FOR INSERT TO authenticated WITH CHECK (uploader_id=auth.uid() AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));
DROP POLICY IF EXISTS "company_files_owner_or_admin_delete" ON public.company_files;
CREATE POLICY "company_files_owner_or_admin_delete" ON public.company_files FOR DELETE TO authenticated USING (uploader_id=auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

-- Direct communications: extend calls/sms/emails with company_id
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.email_logs ADD COLUMN IF NOT EXISTS company_id uuid;
CREATE INDEX IF NOT EXISTS calls_company_started_idx ON public.calls(company_id, started_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_company_created_idx ON public.sms_messages(company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_logs_company_created_idx ON public.email_logs(company_id, created_at DESC) WHERE company_id IS NOT NULL;

-- Final company_feed_list (unified with all sources)
CREATE OR REPLACE FUNCTION public.company_feed_list(_company_id uuid,_types text[] DEFAULT NULL,_search text DEFAULT NULL,_limit int DEFAULT 200,_offset int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_limit int := GREATEST(1, LEAST(COALESCE(_limit,200)+GREATEST(COALESCE(_offset,0),0),500)); v_like text := CASE WHEN _search IS NULL OR btrim(_search)='' THEN NULL ELSE '%'||lower(btrim(_search))||'%' END; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  WITH actor_names AS (SELECT p.user_id, COALESCE(NULLIF(p.full_name,''),p.email) AS name FROM public.profiles p WHERE p.user_id IS NOT NULL),
  contact_items AS (SELECT item || jsonb_build_object('source','contact') AS item FROM public.company_contacts cc CROSS JOIN LATERAL jsonb_array_elements(public.contact_feed_list(cc.profile_id,_types,_search,v_limit,0)) item WHERE cc.company_id=_company_id AND cc.profile_id IS NOT NULL),
  company_calls AS (SELECT jsonb_build_object('id',c.id::text,'kind','call','at',COALESCE(c.started_at,c.created_at),'title',CASE c.direction::text WHEN 'inbound' THEN 'Входящий звонок' WHEN 'outbound' THEN 'Исходящий звонок' ELSE 'Звонок' END,'body',COALESCE(c.summary,''),'meta',jsonb_build_object('public_id',c.public_id,'phone',COALESCE(c.phone_from_e164,c.phone_to_e164,c.phone_from_raw,c.phone_to_raw),'phone_from',COALESCE(c.phone_from_e164,c.phone_from_raw),'phone_to',COALESCE(c.phone_to_e164,c.phone_to_raw),'status',c.status::text,'direction',c.direction::text,'duration',c.duration_seconds,'recording_url',c.recording_url,'transcript',c.transcript,'summary',c.summary),'author',(SELECT name FROM actor_names WHERE user_id=COALESCE(c.manager_user_id,c.created_by) LIMIT 1),'source','company') AS item
    FROM public.calls c WHERE c.company_id=_company_id AND (_types IS NULL OR 'call'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(c.transcript,'')) LIKE v_like OR lower(coalesce(c.summary,'')) LIKE v_like OR lower(coalesce(c.phone_from_e164,'')) LIKE v_like OR lower(coalesce(c.phone_to_e164,'')) LIKE v_like)),
  company_sms AS (SELECT jsonb_build_object('id',s.id::text,'kind','sms','at',s.created_at,'title',CASE WHEN coalesce(s.status,'')='sent' THEN 'SMS отправлено' ELSE 'SMS: '||coalesce(s.status,'без статуса') END,'body',s.text,'meta',jsonb_build_object('phone',s.phone_e164,'status',s.status,'provider',s.provider,'sender',s.sender,'external_id',s.external_id),'author',(SELECT name FROM actor_names WHERE user_id=s.initiator_user_id LIMIT 1),'source','company') AS item
    FROM public.sms_messages s WHERE s.company_id=_company_id AND (_types IS NULL OR 'sms'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(s.text,'')) LIKE v_like OR lower(coalesce(s.phone_e164,'')) LIKE v_like)),
  company_emails AS (SELECT jsonb_build_object('id',e.id::text,'kind','email','at',e.created_at,'title',CASE e.direction WHEN 'outgoing' THEN 'Письмо отправлено' WHEN 'incoming' THEN 'Письмо получено' ELSE 'Письмо' END || COALESCE(': '||NULLIF(e.subject,''),''),'body',COALESCE(e.body_text, regexp_replace(coalesce(e.body_html,''),'<[^>]+>',' ','g')),'meta',jsonb_build_object('from_email',e.from_email,'to_email',e.to_email,'direction',e.direction,'status',e.status,'subject',e.subject),'author',NULL,'source','company') AS item
    FROM public.email_logs e WHERE e.company_id=_company_id AND (_types IS NULL OR 'email'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(e.subject,'')) LIKE v_like OR lower(coalesce(e.body_text,'')) LIKE v_like OR lower(coalesce(e.body_html,'')) LIKE v_like OR lower(coalesce(e.to_email,'')) LIKE v_like)),
  company_notes AS (SELECT jsonb_build_object('id',n.id::text,'kind','note','at',n.created_at,'title','Заметка','body',n.body,'meta',jsonb_build_object('author_id',n.author_id,'source',n.source,'source_key',n.source_key,'metadata',n.metadata,'can_delete',(n.author_id=v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin'))),'author',(SELECT COALESCE(pr.full_name,pr.email) FROM public.profiles pr WHERE pr.user_id=n.author_id LIMIT 1),'source','company') AS item
    FROM public.company_notes n WHERE n.company_id=_company_id AND (_types IS NULL OR 'note'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(n.body,'')) LIKE v_like)),
  company_files AS (SELECT jsonb_build_object('id',f.id::text,'kind',CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm') THEN 'voice_note' ELSE 'file' END,'at',f.created_at,'title',f.name,'body',NULL,'meta',jsonb_build_object('name',f.name,'url',f.url,'storage_path',f.storage_path,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'uploader_id',f.uploader_id,'can_delete',(f.uploader_id=v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')),'transcribe_status',f.meta->>'transcribe_status','transcript',f.meta->>'transcript','summary',f.meta->>'summary'),'author',(SELECT COALESCE(pr.full_name,pr.email) FROM public.profiles pr WHERE pr.user_id=f.uploader_id LIMIT 1),'source','company') AS item
    FROM public.company_files f WHERE f.company_id=_company_id AND (_types IS NULL OR 'file'=ANY(_types) OR 'voice_note'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(f.name,'')) LIKE v_like)),
  company_tasks AS (SELECT jsonb_build_object('id',t.id::text,'kind','task','at',COALESCE(t.due_at,t.created_at),'title',t.title,'body',t.description,'meta',jsonb_build_object('public_id',t.public_id,'status',t.status,'due_at',t.due_at,'assignee_user_id',t.assignee_user_id,'closed_at',t.closed_at,'task_type_id',t.task_type_id),'author',NULL,'source','company') AS item
    FROM public.crm_tasks t WHERE t.company_id=_company_id AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id=_company_id AND cc.profile_id IS NOT NULL AND cc.profile_id=t.contact_id) AND (_types IS NULL OR 'task'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(t.title,'')) LIKE v_like OR lower(coalesce(t.description,'')) LIKE v_like)),
  company_events AS (SELECT jsonb_build_object('id',a.id::text,'kind','event','at',a.created_at,'title',COALESCE(a.title_snapshot,a.activity_type),'body',a.text_snapshot,'meta',jsonb_build_object('activity_type',a.activity_type,'source_entity_type',a.source_entity_type,'source_entity_id',a.source_entity_id,'live_event_id',a.live_event_id),'author',a.author_snapshot,'source','company') AS item
    FROM public.crm_activity_log a WHERE a.source_entity_type='company' AND a.source_entity_id=_company_id AND (_types IS NULL OR 'event'=ANY(_types)) AND (v_like IS NULL OR lower(coalesce(a.title_snapshot,'')) LIKE v_like OR lower(coalesce(a.text_snapshot,'')) LIKE v_like OR lower(coalesce(a.activity_type,'')) LIKE v_like)),
  all_items AS (SELECT item FROM contact_items UNION ALL SELECT item FROM company_calls UNION ALL SELECT item FROM company_sms UNION ALL SELECT item FROM company_emails UNION ALL SELECT item FROM company_notes UNION ALL SELECT item FROM company_files UNION ALL SELECT item FROM company_tasks UNION ALL SELECT item FROM company_events),
  ordered AS (SELECT item FROM all_items ORDER BY (item->>'at')::timestamptz DESC NULLS LAST, item->>'id' LIMIT v_limit OFFSET GREATEST(COALESCE(_offset,0),0))
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'at')::timestamptz DESC NULLS LAST),'[]'::jsonb) INTO v_result FROM ordered;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.company_feed_list(uuid,text[],text,int,int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.company_feed_list(uuid,text[],text,int,int) TO authenticated;