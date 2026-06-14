
-- =============================================================
-- PATCH-PACKAGE-CUSTOM-FIELDS-V1
-- =============================================================

-- 0. Public ID sequence + seed
CREATE SEQUENCE IF NOT EXISTS public.document_package_field_public_id_seq
  START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

INSERT INTO public.public_id_sequences(entity_type, prefix, last_value)
VALUES ('document_package_field', 'pf-', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- =============================================================
-- 1. document_package_field_catalog
-- =============================================================
CREATE TABLE public.document_package_field_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_template_id uuid NOT NULL
    REFERENCES public.document_package_templates(id) ON DELETE CASCADE,
  public_id text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  description text,
  data_type text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_scope text NOT NULL DEFAULT 'package_all',
  client_visible boolean NOT NULL DEFAULT true,
  admin_editable boolean NOT NULL DEFAULT true,
  auto_assign_to_new_items boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT dpfc_data_type_chk CHECK (
    data_type IN ('text','number','date','datetime','time','year','select','multiselect','checkbox')
  ),
  CONSTRAINT dpfc_usage_scope_chk CHECK (
    usage_scope IN ('package_all','questionnaire_only','documents_only')
  ),
  CONSTRAINT dpfc_public_id_format_chk CHECK (public_id ~ '^pf-[0-9]{6,}$')
);

CREATE UNIQUE INDEX uq_dpfc_public_id ON public.document_package_field_catalog(public_id);
CREATE UNIQUE INDEX uq_dpfc_pkg_field_key_active
  ON public.document_package_field_catalog(package_template_id, field_key)
  WHERE is_active = true;
CREATE INDEX idx_dpfc_package ON public.document_package_field_catalog(package_template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_field_catalog TO authenticated;
GRANT ALL ON public.document_package_field_catalog TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.document_package_field_public_id_seq TO authenticated, service_role;

ALTER TABLE public.document_package_field_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpfc_admin_all" ON public.document_package_field_catalog
  TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'))
  WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'));

CREATE POLICY "dpfc_select_for_package_consumers" ON public.document_package_field_catalog
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND package_template_id IN (
      SELECT s.package_template_id
      FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

-- public_id trigger
CREATE OR REPLACE FUNCTION public.assign_package_field_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  next_n bigint;
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    next_n := nextval('public.document_package_field_public_id_seq');
    NEW.public_id := 'pf-' || LPAD(next_n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dpfc_public_id
  BEFORE INSERT ON public.document_package_field_catalog
  FOR EACH ROW EXECUTE FUNCTION public.assign_package_field_public_id();

-- immutability guard
CREATE OR REPLACE FUNCTION public.guard_package_field_catalog_mutations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
      RAISE EXCEPTION 'dpfc_public_id_immutable';
    END IF;
    IF NEW.data_type IS DISTINCT FROM OLD.data_type THEN
      RAISE EXCEPTION 'dpfc_data_type_immutable';
    END IF;
    IF NEW.field_key IS DISTINCT FROM OLD.field_key THEN
      RAISE EXCEPTION 'dpfc_field_key_immutable';
    END IF;
    IF NEW.package_template_id IS DISTINCT FROM OLD.package_template_id THEN
      RAISE EXCEPTION 'dpfc_package_immutable';
    END IF;
    NEW.updated_at := now();
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'dpfc_system_field_delete_forbidden';
    END IF;
    -- block delete if any session value or assignment exists
    IF EXISTS (SELECT 1 FROM public.document_package_session_field_values v WHERE v.field_catalog_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.document_package_item_field_assignments a WHERE a.field_catalog_id = OLD.id)
    THEN
      RAISE EXCEPTION 'dpfc_delete_blocked_dependencies_exist';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_dpfc_guard
  BEFORE UPDATE OR DELETE ON public.document_package_field_catalog
  FOR EACH ROW EXECUTE FUNCTION public.guard_package_field_catalog_mutations();

-- =============================================================
-- 2. document_package_item_field_assignments
-- =============================================================
CREATE TABLE public.document_package_item_field_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_template_item_id uuid NOT NULL
    REFERENCES public.document_package_template_items(id) ON DELETE CASCADE,
  field_catalog_id uuid NOT NULL
    REFERENCES public.document_package_field_catalog(id) ON DELETE RESTRICT,
  visibility_mode text NOT NULL DEFAULT 'ask_client',
  is_required_override boolean,
  label_override text,
  help_override text,
  section_key text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT dpifa_visibility_mode_chk CHECK (
    visibility_mode IN ('ask_client','admin_only','hidden_with_default')
  ),
  CONSTRAINT uq_dpifa UNIQUE (package_template_item_id, field_catalog_id)
);

CREATE INDEX idx_dpifa_item ON public.document_package_item_field_assignments(package_template_item_id);
CREATE INDEX idx_dpifa_field ON public.document_package_item_field_assignments(field_catalog_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_item_field_assignments TO authenticated;
GRANT ALL ON public.document_package_item_field_assignments TO service_role;

ALTER TABLE public.document_package_item_field_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpifa_admin_all" ON public.document_package_item_field_assignments
  TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'))
  WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'));

CREATE POLICY "dpifa_select_for_package_consumers" ON public.document_package_item_field_assignments
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND package_template_item_id IN (
      SELECT it.id
      FROM public.document_package_template_items it
      JOIN public.document_package_sessions s
        ON s.package_template_id = it.package_template_id
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

-- assert field belongs to same package as item
CREATE OR REPLACE FUNCTION public.dpifa_assert_package_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_field_pkg uuid;
  v_item_pkg uuid;
BEGIN
  SELECT package_template_id INTO v_field_pkg
    FROM public.document_package_field_catalog WHERE id = NEW.field_catalog_id;
  SELECT package_template_id INTO v_item_pkg
    FROM public.document_package_template_items WHERE id = NEW.package_template_item_id;
  IF v_field_pkg IS NULL OR v_item_pkg IS NULL THEN
    RAISE EXCEPTION 'dpifa_invalid_references';
  END IF;
  IF v_field_pkg <> v_item_pkg THEN
    RAISE EXCEPTION 'pf_token_outside_bound_package: field.package=% item.package=%',
      v_field_pkg, v_item_pkg;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dpifa_assert_package_match
  BEFORE INSERT OR UPDATE OF field_catalog_id, package_template_item_id
  ON public.document_package_item_field_assignments
  FOR EACH ROW EXECUTE FUNCTION public.dpifa_assert_package_match();

CREATE TRIGGER trg_dpifa_updated_at
  BEFORE UPDATE ON public.document_package_item_field_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. document_package_session_field_values
-- =============================================================
CREATE TABLE public.document_package_session_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES public.document_package_sessions(id) ON DELETE CASCADE,
  field_catalog_id uuid NOT NULL
    REFERENCES public.document_package_field_catalog(id) ON DELETE RESTRICT,
  value_text text,
  value_number numeric,
  value_date date,
  value_datetime timestamptz,
  value_time time,
  value_boolean boolean,
  value_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT uq_dpsfv UNIQUE (session_id, field_catalog_id)
);

CREATE INDEX idx_dpsfv_session ON public.document_package_session_field_values(session_id);
CREATE INDEX idx_dpsfv_field ON public.document_package_session_field_values(field_catalog_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_package_session_field_values TO authenticated;
GRANT ALL ON public.document_package_session_field_values TO service_role;

ALTER TABLE public.document_package_session_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpsfv_admin_all" ON public.document_package_session_field_values
  TO authenticated
  USING (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'))
  WITH CHECK (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin'));

CREATE POLICY "dpsfv_select_own" ON public.document_package_session_field_values
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "dpsfv_insert_own" ON public.document_package_session_field_values
  FOR INSERT TO authenticated
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "dpsfv_update_own" ON public.document_package_session_field_values
  FOR UPDATE TO authenticated
  USING (
    session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_dpsfv_updated_at
  BEFORE UPDATE ON public.document_package_session_field_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 4. Audit trigger for field catalog (mirrors role catalog pattern)
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_package_field_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_pkg uuid;
  v_field_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'document_package_field.created';
    v_before := NULL;
    v_after := to_jsonb(NEW);
    v_pkg := NEW.package_template_id;
    v_field_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN
      v_action := 'document_package_field.archived';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      v_action := 'document_package_field.restored';
    ELSE
      v_action := 'document_package_field.updated';
    END IF;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_pkg := NEW.package_template_id;
    v_field_id := NEW.id;
  ELSE
    v_action := 'document_package_field.deleted';
    v_before := to_jsonb(OLD);
    v_after := NULL;
    v_pkg := OLD.package_template_id;
    v_field_id := OLD.id;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, payload)
  VALUES (
    auth.uid(),
    v_action,
    'document_package_field',
    v_field_id,
    jsonb_build_object(
      'package_template_id', v_pkg,
      'before', v_before,
      'after', v_after
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_dpfc
  AFTER INSERT OR UPDATE OR DELETE
  ON public.document_package_field_catalog
  FOR EACH ROW EXECUTE FUNCTION public.audit_package_field_catalog_change();

-- =============================================================
-- 5. RPC: upsert_package_field_catalog (optimistic concurrency)
-- =============================================================
CREATE OR REPLACE FUNCTION public.upsert_package_field_catalog(
  _payload jsonb,
  _expected_version integer DEFAULT NULL
)
RETURNS public.document_package_field_catalog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.document_package_field_catalog;
  v_id uuid;
  v_existing public.document_package_field_catalog;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_id := NULLIF(_payload->>'id','')::uuid;

  IF v_id IS NULL THEN
    INSERT INTO public.document_package_field_catalog(
      package_template_id, field_key, label, description, data_type,
      options, usage_scope, client_visible, admin_editable,
      auto_assign_to_new_items, required, sort_order, is_active, metadata,
      created_by, updated_by
    ) VALUES (
      (_payload->>'package_template_id')::uuid,
      _payload->>'field_key',
      _payload->>'label',
      _payload->>'description',
      _payload->>'data_type',
      COALESCE(_payload->'options','{}'::jsonb),
      COALESCE(_payload->>'usage_scope','package_all'),
      COALESCE((_payload->>'client_visible')::boolean,true),
      COALESCE((_payload->>'admin_editable')::boolean,true),
      COALESCE((_payload->>'auto_assign_to_new_items')::boolean,false),
      COALESCE((_payload->>'required')::boolean,false),
      COALESCE((_payload->>'sort_order')::integer,100),
      COALESCE((_payload->>'is_active')::boolean,true),
      COALESCE(_payload->'metadata','{}'::jsonb),
      auth.uid(), auth.uid()
    )
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_existing FROM public.document_package_field_catalog WHERE id = v_id FOR UPDATE;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'dpfc_not_found';
    END IF;
    IF _expected_version IS NOT NULL AND v_existing.version <> _expected_version THEN
      RAISE EXCEPTION 'dpfc_version_conflict: expected % current %', _expected_version, v_existing.version;
    END IF;

    UPDATE public.document_package_field_catalog
       SET label = COALESCE(_payload->>'label', label),
           description = COALESCE(_payload->>'description', description),
           options = COALESCE(_payload->'options', options),
           usage_scope = COALESCE(_payload->>'usage_scope', usage_scope),
           client_visible = COALESCE((_payload->>'client_visible')::boolean, client_visible),
           admin_editable = COALESCE((_payload->>'admin_editable')::boolean, admin_editable),
           auto_assign_to_new_items = COALESCE((_payload->>'auto_assign_to_new_items')::boolean, auto_assign_to_new_items),
           required = COALESCE((_payload->>'required')::boolean, required),
           sort_order = COALESCE((_payload->>'sort_order')::integer, sort_order),
           is_active = COALESCE((_payload->>'is_active')::boolean, is_active),
           metadata = COALESCE(_payload->'metadata', metadata),
           version = version + 1,
           updated_by = auth.uid()
     WHERE id = v_id
     RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_package_field_catalog(jsonb, integer) TO authenticated, service_role;

-- =============================================================
-- 6. RPC: report_package_field_dependencies
-- =============================================================
CREATE OR REPLACE FUNCTION public.report_package_field_dependencies(_field_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_templates int;
  v_active_values int;
  v_historical_values int;
  v_snapshots int;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT package_template_item_id) INTO v_templates
    FROM public.document_package_item_field_assignments
   WHERE field_catalog_id = _field_id AND is_active = true;

  SELECT count(*) INTO v_active_values
    FROM public.document_package_session_field_values v
    JOIN public.document_package_sessions s ON s.id = v.session_id
   WHERE v.field_catalog_id = _field_id
     AND s.status NOT IN ('completed','archived','cancelled');

  SELECT count(*) INTO v_historical_values
    FROM public.document_package_session_field_values v
    JOIN public.document_package_sessions s ON s.id = v.session_id
   WHERE v.field_catalog_id = _field_id
     AND s.status IN ('completed','archived','cancelled');

  v_snapshots := 0;

  RETURN jsonb_build_object(
    'templates_using_token', v_templates,
    'active_sessions_with_value', v_active_values,
    'historical_sessions_with_value', v_historical_values,
    'generation_snapshots_count', v_snapshots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_package_field_dependencies(uuid) TO authenticated, service_role;

-- =============================================================
-- 7. RPC: upsert_session_field_values (batch + server-side type validation)
-- =============================================================
CREATE OR REPLACE FUNCTION public.upsert_session_field_values(
  _session_id uuid,
  _values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session public.document_package_sessions;
  v_profile_user uuid;
  v_is_admin boolean;
  v_item jsonb;
  v_field_id uuid;
  v_field public.document_package_field_catalog;
  v_raw text;
  v_errors jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_text text;
  v_num numeric;
  v_date date;
  v_datetime timestamptz;
  v_time time;
  v_bool boolean;
  v_json jsonb;
  v_choices jsonb;
  v_choice text;
BEGIN
  v_is_admin := has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'admin');

  SELECT * INTO v_session FROM public.document_package_sessions WHERE id = _session_id;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF NOT v_is_admin THEN
    SELECT user_id INTO v_profile_user FROM public.profiles WHERE id = v_session.profile_id;
    IF v_profile_user <> auth.uid() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(_values) LOOP
    v_field_id := (v_item->>'field_catalog_id')::uuid;
    SELECT * INTO v_field FROM public.document_package_field_catalog WHERE id = v_field_id;
    IF v_field.id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_field_not_found');
      CONTINUE;
    END IF;
    IF v_field.package_template_id <> v_session.package_template_id THEN
      v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_token_outside_bound_package');
      CONTINUE;
    END IF;

    v_text := NULL; v_num := NULL; v_date := NULL; v_datetime := NULL;
    v_time := NULL; v_bool := NULL; v_json := NULL;

    BEGIN
      CASE v_field.data_type
        WHEN 'text' THEN
          v_text := v_item->>'value';
        WHEN 'number','year' THEN
          v_num := NULLIF(v_item->>'value','')::numeric;
        WHEN 'date' THEN
          v_date := NULLIF(v_item->>'value','')::date;
        WHEN 'datetime' THEN
          v_datetime := NULLIF(v_item->>'value','')::timestamptz;
        WHEN 'time' THEN
          v_time := NULLIF(v_item->>'value','')::time;
        WHEN 'checkbox' THEN
          v_bool := NULLIF(v_item->>'value','')::boolean;
        WHEN 'select' THEN
          v_text := v_item->>'value';
          IF v_text IS NOT NULL THEN
            v_choices := COALESCE(v_field.options->'choices','[]'::jsonb);
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_choices) c
              WHERE c->>'value' = v_text AND COALESCE((c->>'is_archived')::boolean,false) = false
            ) THEN
              v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_invalid_choice','value',v_text);
              CONTINUE;
            END IF;
          END IF;
        WHEN 'multiselect' THEN
          v_json := COALESCE(v_item->'value','[]'::jsonb);
          v_choices := COALESCE(v_field.options->'choices','[]'::jsonb);
          FOR v_choice IN SELECT jsonb_array_elements_text(v_json) LOOP
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_choices) c
              WHERE c->>'value' = v_choice AND COALESCE((c->>'is_archived')::boolean,false) = false
            ) THEN
              v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_invalid_choice','value',v_choice);
              CONTINUE;
            END IF;
          END LOOP;
        ELSE
          v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_unknown_data_type');
          CONTINUE;
      END CASE;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('field_catalog_id', v_field_id, 'code','pf_value_type_mismatch','detail',SQLERRM);
      CONTINUE;
    END;

    INSERT INTO public.document_package_session_field_values(
      session_id, field_catalog_id,
      value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json,
      created_by, updated_by
    ) VALUES (
      _session_id, v_field_id,
      v_text, v_num, v_date, v_datetime, v_time, v_bool, v_json,
      auth.uid(), auth.uid()
    )
    ON CONFLICT (session_id, field_catalog_id) DO UPDATE
      SET value_text = EXCLUDED.value_text,
          value_number = EXCLUDED.value_number,
          value_date = EXCLUDED.value_date,
          value_datetime = EXCLUDED.value_datetime,
          value_time = EXCLUDED.value_time,
          value_boolean = EXCLUDED.value_boolean,
          value_json = EXCLUDED.value_json,
          updated_at = now(),
          updated_by = auth.uid();
    v_ok := v_ok + 1;
  END LOOP;

  RETURN jsonb_build_object('saved', v_ok, 'errors', v_errors);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_session_field_values(uuid, jsonb) TO authenticated, service_role;
