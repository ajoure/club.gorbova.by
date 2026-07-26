-- Generic external document forms.
--
-- An external form is not a new document engine.  It is a public, token-bound
-- way to fill the very same package fields (`document_package_field_catalog`)
-- that an authenticated owner fills in the package questionnaire.  At submit
-- time it creates a regular package session and invokes the existing package
-- orchestrator.

CREATE TABLE public.document_package_external_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_template_item_id uuid NOT NULL UNIQUE
    REFERENCES public.document_package_template_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  allow_attachments boolean NOT NULL DEFAULT true,
  delivery jsonb NOT NULL DEFAULT '{"email":true,"telegram":true,"pdf":true,"docx":true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE TABLE public.document_package_external_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_form_id uuid NOT NULL
    REFERENCES public.document_package_external_forms(id) ON DELETE CASCADE,
  field_catalog_id uuid NOT NULL
    REFERENCES public.document_package_field_catalog(id) ON DELETE RESTRICT,
  -- NULL = ordinary form field.  Equal non-empty values make one repeatable
  -- group.  A group may use only fields from the package of its template item.
  repeat_group_key text,
  sort_order integer NOT NULL DEFAULT 100,
  required_override boolean,
  input_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpeff_repeat_group_key_chk CHECK (
    repeat_group_key IS NULL OR repeat_group_key ~ '^[a-z][a-z0-9_]{1,62}$'
  )
);

CREATE UNIQUE INDEX dpeff_unique_field_per_group_idx
  ON public.document_package_external_form_fields(
    external_form_id, field_catalog_id, coalesce(repeat_group_key, '')
  );

CREATE OR REPLACE FUNCTION public.assert_external_form_field_package_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_package uuid;
  v_field_package uuid;
BEGIN
  SELECT i.package_template_id INTO v_item_package
  FROM public.document_package_external_forms f
  JOIN public.document_package_template_items i ON i.id = f.package_template_item_id
  WHERE f.id = NEW.external_form_id;

  SELECT package_template_id INTO v_field_package
  FROM public.document_package_field_catalog
  WHERE id = NEW.field_catalog_id;

  IF v_item_package IS NULL OR v_field_package IS NULL OR v_item_package <> v_field_package THEN
    RAISE EXCEPTION 'external_form_field_outside_package';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_external_form_field_package_match
  BEFORE INSERT OR UPDATE OF external_form_id, field_catalog_id
  ON public.document_package_external_form_fields
  FOR EACH ROW EXECUTE FUNCTION public.assert_external_form_field_package_match();

CREATE TABLE public.document_package_external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  external_form_id uuid NOT NULL
    REFERENCES public.document_package_external_forms(id) ON DELETE RESTRICT,
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  selected_legal_entity_id uuid NOT NULL REFERENCES public.client_legal_details(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.document_package_external_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_link_id uuid NOT NULL
    REFERENCES public.document_package_external_links(id) ON DELETE RESTRICT,
  external_form_id uuid NOT NULL
    REFERENCES public.document_package_external_forms(id) ON DELETE RESTRICT,
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  package_session_id uuid,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','generating','generated','delivery_partial','failed')),
  error_code text,
  generated_document_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  submitted_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.document_package_sessions
  ADD COLUMN IF NOT EXISTS external_submission_id uuid;

ALTER TABLE public.document_package_external_submissions
  ADD CONSTRAINT dpes_session_fk
  FOREIGN KEY (package_session_id) REFERENCES public.document_package_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.document_package_sessions
  ADD CONSTRAINT dpps_external_submission_fk
  FOREIGN KEY (external_submission_id) REFERENCES public.document_package_external_submissions(id) ON DELETE SET NULL;

-- Normal owner sessions remain unique.  A public link represents a distinct
-- incoming primary document, so each submission gets its own canonical session.
DROP INDEX IF EXISTS public.document_package_sessions_profile_template_uidx;
CREATE UNIQUE INDEX document_package_sessions_profile_template_uidx
  ON public.document_package_sessions(profile_id, package_template_id)
  WHERE status <> 'archived'
    AND entitlement_id IS NULL
    AND order_id IS NULL
    AND external_submission_id IS NULL;

CREATE TABLE public.document_package_external_submission_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.document_package_external_submissions(id) ON DELETE CASCADE,
  repeat_group_key text NOT NULL,
  row_index integer NOT NULL CHECK (row_index >= 0),
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpesr_group_key_chk CHECK (repeat_group_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT dpesr_unique_row UNIQUE (submission_id, repeat_group_key, row_index)
);

CREATE TABLE public.document_package_external_submission_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.document_package_external_submissions(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'document-external-attachments',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  byte_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpes_attachment_path_unique UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX dpe_links_owner_idx ON public.document_package_external_links(owner_profile_id);
CREATE INDEX dpe_submissions_owner_idx ON public.document_package_external_submissions(owner_profile_id, submitted_at DESC);
CREATE INDEX dpe_rows_submission_idx ON public.document_package_external_submission_rows(submission_id, repeat_group_key, row_index);

-- The public browser never gets table or bucket grants.  The Edge Function
-- validates the opaque link token and performs the narrowly scoped service
-- operation.  Owners/admins retain read access to history through RLS.
ALTER TABLE public.document_package_external_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_external_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_external_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_external_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_external_submission_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_external_submission_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_external_document_form(p_form_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin')
$$;

CREATE POLICY dpe_forms_admin_all ON public.document_package_external_forms
  FOR ALL TO authenticated
  USING (public.can_manage_external_document_form(id))
  WITH CHECK (public.can_manage_external_document_form(id));

CREATE POLICY dpe_form_fields_admin_all ON public.document_package_external_form_fields
  FOR ALL TO authenticated
  USING (public.can_manage_external_document_form(external_form_id))
  WITH CHECK (public.can_manage_external_document_form(external_form_id));

CREATE POLICY dpe_links_owner_read ON public.document_package_external_links
  FOR SELECT TO authenticated
  USING (owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY dpe_links_owner_write ON public.document_package_external_links
  FOR ALL TO authenticated
  USING (owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY dpe_submissions_owner_read ON public.document_package_external_submissions
  FOR SELECT TO authenticated
  USING (owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY dpe_rows_owner_read ON public.document_package_external_submission_rows
  FOR SELECT TO authenticated
  USING (submission_id IN (
    SELECT id FROM public.document_package_external_submissions
    WHERE owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  ) OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY dpe_attachments_owner_read ON public.document_package_external_submission_attachments
  FOR SELECT TO authenticated
  USING (submission_id IN (
    SELECT id FROM public.document_package_external_submissions
    WHERE owner_profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  ) OR has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));

-- Runtime entitlement check for a public link.  The check is deliberately
-- evaluated on every view, upload and submit; revoking the owner's package
-- access makes already copied links unusable immediately.
CREATE OR REPLACE FUNCTION public.profile_can_use_document_package(
  p_profile_id uuid,
  p_package_template_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_active boolean;
  v_full boolean := false;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE id = p_profile_id;
  SELECT is_active INTO v_is_active FROM public.document_package_templates WHERE id = p_package_template_id;
  IF v_user_id IS NULL OR coalesce(v_is_active, false) = false THEN RETURN false; END IF;
  IF public.has_role_v2(v_user_id, 'admin') OR public.has_role_v2(v_user_id, 'super_admin') THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.access_rules ar
    WHERE ar.is_active = true
      AND ((ar.grant_target_type = 'section_access' AND ar.target_ref = 'document_generation')
        OR (ar.grant_target_type = 'document_generation' AND coalesce(ar.conditions->>'access_mode', 'full') = 'full'))
      AND public.user_has_access_to_rule(v_user_id, ar.id)
  ) INTO v_full;
  IF v_full THEN RETURN true; END IF;

  SELECT coalesce(array_agg(DISTINCT pid::uuid), ARRAY[]::uuid[]) INTO v_ids
  FROM public.access_rules ar
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(ar.conditions->'allowed_package_ids','[]'::jsonb)) AS pid
  WHERE ar.is_active = true
    AND ar.grant_target_type = 'document_generation'
    AND coalesce(ar.conditions->>'access_mode', 'full') = 'partial'
    AND public.user_has_access_to_rule(v_user_id, ar.id);
  RETURN p_package_template_id = ANY(v_ids);
END;
$$;
GRANT EXECUTE ON FUNCTION public.profile_can_use_document_package(uuid, uuid) TO service_role;

GRANT ALL ON public.document_package_external_forms,
  public.document_package_external_form_fields,
  public.document_package_external_links,
  public.document_package_external_submissions,
  public.document_package_external_submission_rows,
  public.document_package_external_submission_attachments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_external_forms,
  public.document_package_external_form_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_external_links TO authenticated;
GRANT SELECT ON public.document_package_external_submissions,
  public.document_package_external_submission_rows,
  public.document_package_external_submission_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'document-external-attachments',
  'document-external-attachments',
  false,
  20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/heic','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No authenticated/public direct policy: only signed upload URLs issued by the
-- server and the service-role worker may touch this private bucket.

CREATE TRIGGER trg_dpe_forms_updated_at
  BEFORE UPDATE ON public.document_package_external_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dpe_form_fields_updated_at
  BEFORE UPDATE ON public.document_package_external_form_fields
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- One canonical number sequence is shared by all billing-generated documents.
-- Only the visual date segment changes from DDMM to the agreed DD.MM format;
-- already allocated immutable numbers are returned unchanged by the function.
CREATE OR REPLACE FUNCTION public.allocate_document_number(p_document_id uuid, p_now timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(document_number text, document_date date, document_seq integer, document_timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_doc_id uuid; v_existing_number text; v_existing_date date; v_existing_seq integer;
  v_existing_tz text; v_context_type text; v_context_id uuid; v_template_id uuid;
  v_template_version_id uuid; v_profile_id uuid; v_today date; v_tz text := 'Europe/Minsk';
  v_seq integer; v_number text; v_now timestamptz := coalesce(p_now, now());
BEGIN
  SELECT d.id, d.document_number, d.document_date, d.document_seq, d.document_timezone,
         d.context_type, d.context_id, d.template_id, d.template_version_id, d.profile_id
    INTO v_doc_id, v_existing_number, v_existing_date, v_existing_seq, v_existing_tz,
         v_context_type, v_context_id, v_template_id, v_template_version_id, v_profile_id
  FROM public.ai_generated_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF v_doc_id IS NULL THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_existing_number IS NOT NULL THEN
    document_number := v_existing_number; document_date := v_existing_date;
    document_seq := v_existing_seq; document_timezone := coalesce(v_existing_tz, v_tz);
    RETURN NEXT; RETURN;
  END IF;
  v_today := (v_now AT TIME ZONE v_tz)::date;
  INSERT INTO public.document_number_counters AS c (document_date, document_timezone, last_seq)
  VALUES (v_today, v_tz, 1)
  ON CONFLICT (document_date, document_timezone)
  DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING c.last_seq INTO v_seq;
  v_number := to_char(v_today, 'DD.MM') || '/' || v_seq::text;
  UPDATE public.ai_generated_documents SET document_number = v_number, document_date = v_today,
    document_seq = v_seq, document_timezone = v_tz, document_number_assigned_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
  VALUES (NULL, 'system', 'document_numbering_v2', 'document_number.assigned', jsonb_build_object(
    'document_id', v_doc_id, 'context_type', v_context_type, 'context_id', v_context_id,
    'template_id', v_template_id, 'template_version_id', v_template_version_id,
    'profile_id', v_profile_id, 'document_number', v_number, 'document_date', v_today,
    'document_seq', v_seq, 'timezone', v_tz));
  document_number := v_number; document_date := v_today; document_seq := v_seq;
  document_timezone := v_tz; RETURN NEXT;
END;
$function$;
