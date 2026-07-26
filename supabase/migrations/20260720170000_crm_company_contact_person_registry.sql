-- Companies Phase 10A: external contact-person registry.
-- A person without a confirmed platform profile is kept here instead of being
-- silently represented as a profiles row or an ad-hoc company contact.

CREATE TABLE IF NOT EXISTS public.company_contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 256),
  job_title text,
  email text,
  phone text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  consent_status text NOT NULL DEFAULT 'unknown'
    CHECK (consent_status IN ('unknown','pending','granted','denied')),
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS company_contact_persons_profile_uniq
  ON public.company_contact_persons(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_contact_persons_email_idx
  ON public.company_contact_persons(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_contact_persons_phone_idx
  ON public.company_contact_persons(phone) WHERE phone IS NOT NULL;

DROP TRIGGER IF EXISTS update_company_contact_persons_updated_at ON public.company_contact_persons;
CREATE TRIGGER update_company_contact_persons_updated_at
  BEFORE UPDATE ON public.company_contact_persons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.company_contact_person_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.company_contact_persons(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'director','accountant','founder','beneficial_owner',
    'authorized_representative','employee','billing_contact','contract_signatory'
  )),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','document_review','integration','billing_requisites')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT company_contact_person_links_dates_chk CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT company_contact_person_links_unique_role UNIQUE (company_id, person_id, role)
);

CREATE INDEX IF NOT EXISTS company_contact_person_links_company_idx
  ON public.company_contact_person_links(company_id, is_current, role);
CREATE INDEX IF NOT EXISTS company_contact_person_links_person_idx
  ON public.company_contact_person_links(person_id, is_current);

DROP TRIGGER IF EXISTS update_company_contact_person_links_updated_at ON public.company_contact_person_links;
CREATE TRIGGER update_company_contact_person_links_updated_at
  BEFORE UPDATE ON public.company_contact_person_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.company_contact_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contact_person_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company contact persons read for CRM staff" ON public.company_contact_persons;
CREATE POLICY "company contact persons read for CRM staff"
  ON public.company_contact_persons FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin')
    OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support')
  );
DROP POLICY IF EXISTS "company contact persons write for admin+manager" ON public.company_contact_persons;
CREATE POLICY "company contact persons write for admin+manager"
  ON public.company_contact_persons FOR ALL TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'))
  WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'));

DROP POLICY IF EXISTS "company contact person links read for CRM staff" ON public.company_contact_person_links;
CREATE POLICY "company contact person links read for CRM staff"
  ON public.company_contact_person_links FOR SELECT TO authenticated
  USING (
    has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin')
    OR has_role_v2(auth.uid(),'menedzher') OR has_role_v2(auth.uid(),'support')
  );
DROP POLICY IF EXISTS "company contact person links write for admin+manager" ON public.company_contact_person_links;
CREATE POLICY "company contact person links write for admin+manager"
  ON public.company_contact_person_links FOR ALL TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'))
  WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'menedzher'));

CREATE OR REPLACE FUNCTION public.crm_company_contact_person_upsert(
  _person_id uuid DEFAULT NULL,
  _full_name text DEFAULT NULL,
  _job_title text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _source text DEFAULT 'manual',
  _profile_id uuid DEFAULT NULL,
  _consent_status text DEFAULT 'unknown',
  _external_ids jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := _person_id;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF _source NOT IN ('manual','import','document_review','integration','billing_requisites') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;
  IF _consent_status NOT IN ('unknown','pending','granted','denied') THEN
    RAISE EXCEPTION 'invalid consent status' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.company_contact_persons (full_name, job_title, email, phone, source, profile_id, consent_status, external_ids, metadata, created_by, updated_by)
    VALUES (btrim(_full_name), NULLIF(btrim(_job_title), ''), NULLIF(lower(btrim(_email)), ''), NULLIF(btrim(_phone), ''), _source, _profile_id, _consent_status, coalesce(_external_ids, '{}'::jsonb), coalesce(_metadata, '{}'::jsonb), v_uid, v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.company_contact_persons
       SET full_name = btrim(_full_name), job_title = NULLIF(btrim(_job_title), ''), email = NULLIF(lower(btrim(_email)), ''), phone = NULLIF(btrim(_phone), ''), source = _source, profile_id = _profile_id, consent_status = _consent_status, external_ids = coalesce(_external_ids, '{}'::jsonb), metadata = coalesce(_metadata, '{}'::jsonb), updated_by = v_uid
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact person not found' USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_contact_person_link(
  _company_id uuid,
  _person_id uuid,
  _role text,
  _valid_from date DEFAULT current_date,
  _valid_to date DEFAULT NULL,
  _is_current boolean DEFAULT true,
  _source text DEFAULT 'manual',
  _evidence jsonb DEFAULT '{}'::jsonb,
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
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _company_id AND c.status <> 'merged') THEN
    RAISE EXCEPTION 'company not found or merged' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_contact_persons p WHERE p.id = _person_id) THEN
    RAISE EXCEPTION 'contact person not found' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.company_contact_person_links (company_id, person_id, role, valid_from, valid_to, is_current, source, evidence, metadata, created_by, updated_by)
  VALUES (_company_id, _person_id, _role, coalesce(_valid_from, current_date), _valid_to, coalesce(_is_current, true), _source, coalesce(_evidence, '{}'::jsonb), coalesce(_metadata, '{}'::jsonb), v_uid, v_uid)
  ON CONFLICT (company_id, person_id, role) DO UPDATE
    SET valid_from = excluded.valid_from, valid_to = excluded.valid_to, is_current = excluded.is_current, source = excluded.source, evidence = excluded.evidence, metadata = excluded.metadata, updated_by = v_uid, updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type, user_id, idempotency_key, title_snapshot, text_snapshot, metadata)
  SELECT 'company.contact_person.linked', _company_id, 'company', v_uid,
         'company.contact_person.linked:' || v_id::text || ':' || _role || ':' || coalesce(_is_current::text, 'true'),
         'Контактное лицо компании обновлено', _role,
         jsonb_build_object('person_id', _person_id, 'role', _role, 'is_current', coalesce(_is_current, true))
   WHERE NOT EXISTS (
     SELECT 1 FROM public.crm_activity_log a
      WHERE a.idempotency_key = 'company.contact_person.linked:' || v_id::text || ':' || _role || ':' || coalesce(_is_current::text, 'true')
   );
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_contact_persons_list(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT (
    has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
    OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'link_id', l.id, 'person_id', p.id, 'profile_id', p.profile_id,
    'full_name', p.full_name, 'job_title', p.job_title, 'email', p.email,
    'phone', p.phone, 'role', l.role, 'valid_from', l.valid_from,
    'valid_to', l.valid_to, 'is_current', l.is_current, 'source', l.source,
    'consent_status', p.consent_status, 'external_ids', p.external_ids,
    'evidence', l.evidence, 'updated_at', l.updated_at
  ) ORDER BY l.is_current DESC, p.full_name), '[]'::jsonb)
    INTO v_result
   FROM public.company_contact_person_links l
    JOIN public.company_contact_persons p ON p.id = l.person_id
   WHERE l.company_id = _company_id;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_contact_person_upsert(uuid,text,text,text,text,text,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_contact_person_link(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_contact_persons_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_person_upsert(uuid,text,text,text,text,text,uuid,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_person_link(uuid,uuid,text,date,date,boolean,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_contact_persons_list(uuid) TO authenticated;
