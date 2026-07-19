BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 11.1.a Preflight
DO $preflight$
DECLARE v_hash text; v_pol int; v_sg_sha text; v_sg_md5 text; v_sg_oid oid;
BEGIN
  -- 4 таблицы
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.company_contacts') IS NULL
     OR to_regclass('public.client_legal_details_company_map') IS NULL
     OR to_regclass('public.company_sync_queue') IS NULL THEN
    RAISE EXCEPTION 'preflight: phase1 tables missing';
  END IF;

  -- RLS
  PERFORM 1 FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relname IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue')
    AND NOT relrowsecurity;
  IF FOUND THEN RAISE EXCEPTION 'preflight: RLS drift'; END IF;

  -- 13 policies
  SELECT count(*) INTO v_pol FROM pg_policy pl JOIN pg_class c ON c.oid=pl.polrelid
   WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue');
  IF v_pol <> 13 THEN RAISE EXCEPTION 'preflight: expected 13 policies, got %', v_pol; END IF;

  -- Baseline hash
  SELECT md5(string_agg(table_name || ':' || column_name || ':' || data_type,
                        ',' ORDER BY table_name, ordinal_position))
    INTO v_hash
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('client_legal_details','profiles','public_id_sequences','roles',
                        'role_admin_resource_access','role_admin_section_access','admin_section');
  IF v_hash <> 'c41160b83c8e15c3d3c41a13028700d5' THEN
    RAISE EXCEPTION 'preflight: baseline hash drift %', v_hash;
  END IF;

  -- Skeleton signatures
  PERFORM 1 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='crm_company_get_or_create'
     AND pg_get_function_identity_arguments(oid)
         = '_country text, _unp text, _full_name text, _company_kind text, _source text, _source_client_legal_details_id uuid';
  IF NOT FOUND THEN RAISE EXCEPTION 'preflight: crm_company_get_or_create signature drift'; END IF;

  PERFORM 1 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='crm_company_link_contact'
     AND pg_get_function_identity_arguments(oid)
         = '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid';
  IF NOT FOUND THEN RAISE EXCEPTION 'preflight: crm_company_link_contact signature drift'; END IF;

  -- pre-Phase-2 search_global executable hash guard: SHA-256 via pgcrypto.digest if present,
  -- otherwise md5(pg_get_functiondef(function_oid)) fallback fixed in §2.5.
  SELECT oid INTO v_sg_oid
    FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='search_global'
     AND pg_get_function_identity_arguments(oid) = 'p_query text, p_limit integer, p_offset integer';
  IF v_sg_oid IS NULL THEN
    RAISE EXCEPTION 'preflight: search_global(text,integer,integer) missing';
  END IF;

  IF to_regprocedure('digest(bytea,text)') IS NOT NULL THEN
    EXECUTE 'SELECT encode(digest(convert_to(pg_get_functiondef($1), ''UTF8''), ''sha256''), ''hex'')'
      INTO v_sg_sha
      USING v_sg_oid;
    IF v_sg_sha <> '3f52ef62916b655d386f56ea1a44d78e261037a19b8c83d674ce09f6dd967e9f' THEN
      RAISE EXCEPTION 'preflight: search_global body drifted from expected SHA (got %)', v_sg_sha;
    END IF;
  ELSE
    SELECT md5(pg_get_functiondef(v_sg_oid)) INTO v_sg_md5;
    IF v_sg_md5 <> '7641d12fc0bea802a93935a384e7e349' THEN
      RAISE EXCEPTION 'preflight: search_global body drifted from expected md5 fallback (got %)', v_sg_md5;
    END IF;
  END IF;
END
$preflight$;
-- 11.2.a Private emit helper — дедуплицированная запись в domain_events (§10.1)
CREATE OR REPLACE FUNCTION public._crm_company_emit_domain_event(
  _event_type      text,
  _entity_id       uuid,
  _idempotency_key text,
  _payload         jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_existing uuid; v_new uuid;
BEGIN
  IF _event_type IS NULL OR _event_type NOT LIKE 'company.%' THEN
    RAISE EXCEPTION 'emit: bad event_type %', _event_type;
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'emit: bad idempotency_key';
  END IF;
  IF NOT (_payload ? 'version') OR (_payload->>'version') <> '1' THEN
    RAISE EXCEPTION 'emit: payload version must be 1';
  END IF;
  IF coalesce(_payload->>'idempotency_key','') <> _idempotency_key THEN
    RAISE EXCEPTION 'emit: payload/key mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm_company_emit:' || _idempotency_key, 0));

  SELECT id INTO v_existing FROM public.domain_events
   WHERE event_type = _event_type
     AND payload->>'idempotency_key' = _idempotency_key
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NULL;  -- дубль подавлен
  END IF;

  INSERT INTO public.domain_events(event_type, source, entity_id, payload)
  VALUES (_event_type, 'crm', _entity_id, _payload)
  RETURNING id INTO v_new;
  RETURN v_new;
END $$;

-- 11.2.b Private resolve/create helper

CREATE OR REPLACE FUNCTION public._crm_company_resolve_or_create_internal(
  _country text, _unp_normalized text, _full_name text, _company_kind text,
  _actor_user_id uuid, _source text, _source_cld_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.companies%ROWTYPE;
  v_leaf    public.companies%ROWTYPE;
  v_id      uuid;
  v_country text;
  v_meta    jsonb;
  v_next    uuid;
  v_seen    uuid[] := '{}';
  v_depth   int := 0;
BEGIN
  IF _company_kind NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'company_kind must be legal_entity or entrepreneur' USING ERRCODE='22023';
  END IF;
  IF _unp_normalized IS NULL OR length(_unp_normalized) = 0 THEN
    RAISE EXCEPTION 'unp is required' USING ERRCODE='23514';
  END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) = 0 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE='23514';
  END IF;

  v_country := upper(coalesce(_country,'BY'));

  PERFORM pg_advisory_xact_lock(hashtextextended('crm_company_resolve:' || v_country || ':' || _unp_normalized, 0));

  SELECT * INTO v_row FROM public.companies
   WHERE country = v_country
     AND unp_normalized = _unp_normalized
   ORDER BY CASE WHEN status <> 'merged' THEN 0 ELSE 1 END, created_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.status <> 'merged' THEN
      RETURN v_row.id;
    END IF;

    v_next := v_row.merged_into_company_id;
    LOOP
      v_depth := v_depth + 1;
      IF v_next IS NULL THEN
        RAISE EXCEPTION 'resolve: merged company % has no target', v_row.id USING ERRCODE='22023';
      END IF;
      IF v_depth > 32 OR v_next = ANY(v_seen) THEN
        RAISE EXCEPTION 'resolve: merged chain broken or cyclic for %/%', v_country, _unp_normalized USING ERRCODE='22023';
      END IF;
      v_seen := v_seen || v_next;

      SELECT * INTO v_leaf FROM public.companies WHERE id = v_next FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'resolve: merged target % not found', v_next USING ERRCODE='23503';
      END IF;
      IF v_leaf.status <> 'merged' THEN
        RETURN v_leaf.id;
      END IF;
      v_next := v_leaf.merged_into_company_id;
    END LOOP;
  END IF;

  v_meta := jsonb_build_object(
    'company_sync', jsonb_build_object(
      'billing_snapshot', '{}'::jsonb,
      'last_billing_client_legal_details_id', to_jsonb(_source_cld_id),
      'last_billing_synced_at', to_jsonb(now()),
      'last_billing_source_updated_at', null
    ),
    'created_source', to_jsonb(_source)
  );

  INSERT INTO public.companies (
    workspace_id, company_kind, country, unp_normalized, full_name,
    metadata, created_by, updated_by
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    _company_kind, v_country, _unp_normalized, btrim(_full_name),
    v_meta, _actor_user_id, _actor_user_id
  )
  RETURNING id INTO v_id;

  -- trigger set_companies_public_id проставляет public_id

  PERFORM public._crm_company_emit_domain_event(
    'company.created.v1',
    v_id,
    'company.created:' || v_id::text,
    jsonb_build_object(
      'version', 1,
      'company_id', v_id,
      'public_id', (SELECT public_id FROM public.companies WHERE id=v_id),
      'country', v_country,
      'unp_normalized', _unp_normalized,
      'company_kind', _company_kind,
      'source', _source,
      'source_cld_id', _source_cld_id,
      'actor_user_id', _actor_user_id,
      'occurred_at', now(),
      'idempotency_key', 'company.created:' || v_id::text
    )
  );

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public._crm_company_resolve_or_create_internal(
  text, text, text, text, uuid, text, uuid)
FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_unp text; v_id uuid; v_cld public.client_legal_details%ROWTYPE;
BEGIN
  -- role guard (Phase 2 сохраняет tribution admin/super_admin/menedzher)
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  -- _source contract
  IF _source NOT IN ('manual','billing_requisites','backfill') THEN
    RAISE EXCEPTION 'invalid _source: %', _source USING ERRCODE='22023';
  END IF;
  IF _source = 'manual' AND _source_client_legal_details_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual source must not reference a client_legal_details_id' USING ERRCODE='22023';
  END IF;
  IF _source IN ('billing_requisites','backfill') THEN
    IF _source_client_legal_details_id IS NULL THEN
      RAISE EXCEPTION 'billing/backfill source requires client_legal_details_id' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_cld FROM public.client_legal_details WHERE id=_source_client_legal_details_id;
    IF NOT FOUND OR v_cld.purpose <> 'billing' OR v_cld.client_type NOT IN ('legal_entity','entrepreneur') THEN
      RAISE EXCEPTION 'referenced cld is not a billing legal_entity/entrepreneur' USING ERRCODE='22023';
    END IF;
  END IF;

  v_unp := regexp_replace(coalesce(_unp,''), '\D', '', 'g');

  v_id := public._crm_company_resolve_or_create_internal(
    _country, v_unp, _full_name, _company_kind, auth.uid(), _source, _source_client_legal_details_id);

  -- manual source → audit_logs (guarded)
  IF _source = 'manual' THEN
    INSERT INTO public.audit_logs (actor_user_id, action, actor_type, entity_type, entity_id, meta)
    SELECT auth.uid(), 'company.create', 'user', 'company', v_id::text,
           jsonb_build_object('idempotency_key', 'company.create:' || v_id::text, 'source', _source)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action='company.create' AND entity_type='company' AND entity_id=v_id::text);
  END IF;

  -- crm_activity_log (guarded)
  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                       user_id, idempotency_key, metadata)
  SELECT 'company.created', v_id, 'company', auth.uid(),
         'company.created:' || v_id::text,
         jsonb_build_object('source', _source, 'source_cld_id', _source_client_legal_details_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=v_id
       AND idempotency_key='company.created:' || v_id::text);

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_existing public.company_contacts%ROWTYPE;
        v_material boolean := false; v_first_insert boolean := false;
        v_company public.companies%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF _profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id required in phase 2' USING ERRCODE='22023';
  END IF;
  IF _relationship_type IS NULL OR length(btrim(_relationship_type)) = 0 THEN
    RAISE EXCEPTION 'relationship_type required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_company.status = 'merged' THEN
    RAISE EXCEPTION 'merged company is not linkable' USING ERRCODE='22023';
  END IF;

  IF _is_billing_contact THEN
    IF _source <> 'billing_requisites' THEN
      RAISE EXCEPTION 'billing flag requires source=billing_requisites' USING ERRCODE='22023';
    END IF;
    IF _source_client_legal_details_map_id IS NULL THEN
      RAISE EXCEPTION 'source_client_legal_details_map_id required for billing contact' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.client_legal_details_company_map
     WHERE id = _source_client_legal_details_map_id AND company_id = _company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'map does not belong to company' USING ERRCODE='23503';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'crm_company_link_contact:' || _company_id::text || ':' || _profile_id::text || ':' || btrim(_relationship_type), 0));

  SELECT * INTO v_existing FROM public.company_contacts
   WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
   FOR UPDATE;

  IF FOUND THEN
    v_id := v_existing.id;
    IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
       OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
       OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
      v_material := true;
    END IF;

    UPDATE public.company_contacts SET
      is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
      source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                    _source_client_legal_details_map_id),
      source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                    THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
      updated_by = auth.uid(), updated_at = now()
    WHERE id = v_id;
  ELSE
    BEGIN
      INSERT INTO public.company_contacts (
        company_id, profile_id, relationship_type,
        is_billing_contact, source, source_client_legal_details_map_id,
        created_by, updated_by
      ) VALUES (
        _company_id, _profile_id, _relationship_type,
        COALESCE(_is_billing_contact,false), _source, _source_client_legal_details_map_id,
        auth.uid(), auth.uid()
      )
      RETURNING id INTO v_id;
      v_first_insert := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.company_contacts
       WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
       FOR UPDATE;
      IF NOT FOUND THEN RAISE; END IF;
      v_id := v_existing.id;
      IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
         OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
         OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
        v_material := true;
      END IF;
      UPDATE public.company_contacts SET
        is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
        source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                      _source_client_legal_details_map_id),
        source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                      THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
        updated_by = auth.uid(), updated_at = now()
      WHERE id = v_id;
    END;
  END IF;

  IF v_first_insert THEN
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      'company.linked_to_contact:' || v_id::text,
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'profile_id', _profile_id,
        'relationship_type', _relationship_type, 'is_billing_contact', COALESCE(_is_billing_contact,false),
        'source', _source, 'source_map_id', _source_client_legal_details_map_id,
        'occurred_at', now(),
        'idempotency_key', 'company.linked_to_contact:' || v_id::text
      )
    );
  ELSIF v_material THEN
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      'company.linked_to_contact.updated:' || v_id::text || ':' ||
        md5(coalesce(_source,'') || ':' || coalesce(_is_billing_contact::text,'') || ':' ||
            coalesce(_source_client_legal_details_map_id::text,'')),
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'update', true,
        'occurred_at', now(),
        'idempotency_key', 'company.linked_to_contact.updated:' || v_id::text || ':' ||
                           md5(coalesce(_source,'') || ':' || coalesce(_is_billing_contact::text,'') || ':' ||
                               coalesce(_source_client_legal_details_map_id::text,''))
      )
    );
  END IF;

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_upsert_from_billing(_client_legal_details_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_cld       public.client_legal_details%ROWTYPE;
  v_company   public.companies%ROWTYPE;
  v_country   text := 'BY';
  v_unp       text;
  v_kind      text;
  v_full      text;
  v_id        uuid;
  v_snap      jsonb;
  v_prev_src  timestamptz;
  v_changed   text[] := '{}';
  v_conflicts text[] := '{}';
  v_first_billing_sync boolean := false;
  v_values_hash text;
  v_event_key text;
  -- Нормализованные значения per §4 (последний non-null billing wins; NULL = не трогать)
  n_full_name         text;
  n_short_name        text;
  n_legal_form        text;
  n_legal_address     text;
  n_director_name     text;
  n_director_position text;
  n_acts_on_basis     text;
  n_bank_account      text;
  n_bank_name         text;
  n_bank_code         text;
  n_email             text;
  n_phone             text;
  -- Новые значения после применения ownership (по умолчанию = текущее значение target)
  new_full_name         text;
  new_short_name        text;
  new_legal_form        text;
  new_legal_address     text;
  new_director_name     text;
  new_director_position text;
  new_acts_on_basis     text;
  new_bank_account      text;
  new_bank_name         text;
  new_bank_code         text;
  new_email             text;
  new_phone             text;
BEGIN
  SELECT * INTO v_cld FROM public.client_legal_details WHERE id=_client_legal_details_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cld not found' USING ERRCODE='23503'; END IF;
  IF v_cld.purpose <> 'billing' THEN
    RAISE EXCEPTION 'cld.purpose must be billing' USING ERRCODE='22023'; END IF;
  IF v_cld.client_type NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'cld.client_type must be legal_entity or entrepreneur' USING ERRCODE='22023'; END IF;

  v_kind := v_cld.client_type;
  IF v_kind = 'legal_entity' THEN
    v_unp  := regexp_replace(coalesce(v_cld.leg_unp,''),'\D','','g');
    v_full := NULLIF(btrim(concat_ws(' ', v_cld.leg_org_form, v_cld.leg_name)),'');
  ELSE
    v_unp  := regexp_replace(coalesce(v_cld.ent_unp,''),'\D','','g');
    v_full := NULLIF(btrim(v_cld.ent_name),'');
  END IF;
  IF length(v_unp) = 0 OR v_full IS NULL THEN
    RAISE EXCEPTION 'billing cld missing unp or full_name' USING ERRCODE='23514';
  END IF;

  -- create-or-resolve через private helper (set-once поля: country/unp_normalized/company_kind
  -- задаются только при INSERT canonical company)
  v_id := public._crm_company_resolve_or_create_internal(
    v_country, v_unp, v_full, v_kind, NULL::uuid, 'billing_requisites', _client_legal_details_id);

  SELECT * INTO v_company FROM public.companies WHERE id=v_id FOR UPDATE;

  -- stale detection: если source updated_at раньше зафиксированного — идемпотентный no-op
  v_prev_src := (v_company.metadata->'company_sync'->>'last_billing_source_updated_at')::timestamptz;
  IF v_prev_src IS NOT NULL AND v_cld.updated_at IS NOT NULL AND v_cld.updated_at < v_prev_src THEN
    RETURN v_id;
  END IF;

  v_snap := COALESCE(v_company.metadata->'company_sync'->'billing_snapshot','{}'::jsonb);
  v_first_billing_sync := (v_company.metadata->'company_sync'->>'last_billing_source_updated_at') IS NULL
                          AND v_snap = '{}'::jsonb;

  -- Нормализация 12 mutable-полей строго по §4
  n_full_name         := v_full;
  n_short_name        := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_name),'')
                             ELSE NULLIF(btrim(v_cld.ent_name),'') END;
  n_legal_form        := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_org_form),'')
                             ELSE NULL END;
  n_legal_address     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_address),'')
                             ELSE NULLIF(btrim(v_cld.ent_address),'') END;
  n_director_name     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_director_name),'')
                             ELSE NULL END;
  n_director_position := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_director_position),'')
                             ELSE NULL END;
  n_acts_on_basis     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_acts_on_basis),'')
                             ELSE NULLIF(btrim(v_cld.ent_acts_on_basis),'') END;
  n_bank_account      := NULLIF(btrim(v_cld.bank_account),'');
  n_bank_name         := NULLIF(btrim(v_cld.bank_name),'');
  n_bank_code         := NULLIF(btrim(v_cld.bank_code),'');
  n_email             := NULLIF(lower(btrim(v_cld.email)),'');
  n_phone             := NULLIF(regexp_replace(coalesce(v_cld.phone,''),'[^\d+]','','g'),'');

  -- Default new_* = текущее значение target
  new_full_name         := v_company.full_name;
  new_short_name        := v_company.short_name;
  new_legal_form        := v_company.legal_form;
  new_legal_address     := v_company.legal_address;
  new_director_name     := v_company.director_name;
  new_director_position := v_company.director_position;
  new_acts_on_basis     := v_company.acts_on_basis;
  new_bank_account      := v_company.bank_account;
  new_bank_name         := v_company.bank_name;
  new_bank_code         := v_company.bank_code;
  new_email             := v_company.email;
  new_phone             := v_company.phone;

  -- Ownership §5 для каждого mutable-поля.
  -- Инвариант NULL: если normalized billing = NULL, target/snapshot/conflict не трогаем.

  -- full_name
  IF n_full_name IS NOT NULL THEN
    IF v_company.full_name IS NULL
       OR v_company.full_name IS NOT DISTINCT FROM (v_snap->>'full_name') THEN
      new_full_name := n_full_name;
      v_snap := jsonb_set(v_snap, '{full_name}', to_jsonb(n_full_name));
      v_changed := v_changed || 'full_name';
    ELSE
      v_snap := jsonb_set(v_snap, '{full_name}', to_jsonb(n_full_name));
      v_conflicts := v_conflicts || 'full_name';
    END IF;
  END IF;

  -- short_name
  IF n_short_name IS NOT NULL THEN
    IF v_company.short_name IS NULL
       OR v_company.short_name IS NOT DISTINCT FROM (v_snap->>'short_name') THEN
      new_short_name := n_short_name;
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_changed := v_changed || 'short_name';
    ELSE
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_conflicts := v_conflicts || 'short_name';
    END IF;
  END IF;

  -- legal_form
  IF n_legal_form IS NOT NULL THEN
    IF v_company.legal_form IS NULL
       OR v_company.legal_form IS NOT DISTINCT FROM (v_snap->>'legal_form') THEN
      new_legal_form := n_legal_form;
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_changed := v_changed || 'legal_form';
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_conflicts := v_conflicts || 'legal_form';
    END IF;
  END IF;

  -- legal_address
  IF n_legal_address IS NOT NULL THEN
    IF v_company.legal_address IS NULL
       OR v_company.legal_address IS NOT DISTINCT FROM (v_snap->>'legal_address') THEN
      new_legal_address := n_legal_address;
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_changed := v_changed || 'legal_address';
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_conflicts := v_conflicts || 'legal_address';
    END IF;
  END IF;

  -- director_name
  IF n_director_name IS NOT NULL THEN
    IF v_company.director_name IS NULL
       OR v_company.director_name IS NOT DISTINCT FROM (v_snap->>'director_name') THEN
      new_director_name := n_director_name;
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_changed := v_changed || 'director_name';
    ELSE
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_conflicts := v_conflicts || 'director_name';
    END IF;
  END IF;

  -- director_position
  IF n_director_position IS NOT NULL THEN
    IF v_company.director_position IS NULL
       OR v_company.director_position IS NOT DISTINCT FROM (v_snap->>'director_position') THEN
      new_director_position := n_director_position;
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_changed := v_changed || 'director_position';
    ELSE
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_conflicts := v_conflicts || 'director_position';
    END IF;
  END IF;

  -- acts_on_basis
  IF n_acts_on_basis IS NOT NULL THEN
    IF v_company.acts_on_basis IS NULL
       OR v_company.acts_on_basis IS NOT DISTINCT FROM (v_snap->>'acts_on_basis') THEN
      new_acts_on_basis := n_acts_on_basis;
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_changed := v_changed || 'acts_on_basis';
    ELSE
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_conflicts := v_conflicts || 'acts_on_basis';
    END IF;
  END IF;

  -- bank_account
  IF n_bank_account IS NOT NULL THEN
    IF v_company.bank_account IS NULL
       OR v_company.bank_account IS NOT DISTINCT FROM (v_snap->>'bank_account') THEN
      new_bank_account := n_bank_account;
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_changed := v_changed || 'bank_account';
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_conflicts := v_conflicts || 'bank_account';
    END IF;
  END IF;

  -- bank_name
  IF n_bank_name IS NOT NULL THEN
    IF v_company.bank_name IS NULL
       OR v_company.bank_name IS NOT DISTINCT FROM (v_snap->>'bank_name') THEN
      new_bank_name := n_bank_name;
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_changed := v_changed || 'bank_name';
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_conflicts := v_conflicts || 'bank_name';
    END IF;
  END IF;

  -- bank_code
  IF n_bank_code IS NOT NULL THEN
    IF v_company.bank_code IS NULL
       OR v_company.bank_code IS NOT DISTINCT FROM (v_snap->>'bank_code') THEN
      new_bank_code := n_bank_code;
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_changed := v_changed || 'bank_code';
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_conflicts := v_conflicts || 'bank_code';
    END IF;
  END IF;

  -- email
  IF n_email IS NOT NULL THEN
    IF v_company.email IS NULL
       OR v_company.email IS NOT DISTINCT FROM (v_snap->>'email') THEN
      new_email := n_email;
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_changed := v_changed || 'email';
    ELSE
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_conflicts := v_conflicts || 'email';
    END IF;
  END IF;

  -- phone
  IF n_phone IS NOT NULL THEN
    IF v_company.phone IS NULL
       OR v_company.phone IS NOT DISTINCT FROM (v_snap->>'phone') THEN
      new_phone := n_phone;
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_changed := v_changed || 'phone';
    ELSE
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_conflicts := v_conflicts || 'phone';
    END IF;
  END IF;


  -- Удаление ложных changed/conflict: поле считается changed только при реальном отличии target → new_*.
  -- Если billing-значение совпало с текущим target, повторный вызов с тем же source version остаётся no-op.
  v_changed := COALESCE(ARRAY(
    SELECT DISTINCT field FROM unnest(v_changed) AS field
     WHERE CASE field
       WHEN 'full_name'         THEN v_company.full_name         IS DISTINCT FROM new_full_name
       WHEN 'short_name'        THEN v_company.short_name        IS DISTINCT FROM new_short_name
       WHEN 'legal_form'        THEN v_company.legal_form        IS DISTINCT FROM new_legal_form
       WHEN 'legal_address'     THEN v_company.legal_address     IS DISTINCT FROM new_legal_address
       WHEN 'director_name'     THEN v_company.director_name     IS DISTINCT FROM new_director_name
       WHEN 'director_position' THEN v_company.director_position IS DISTINCT FROM new_director_position
       WHEN 'acts_on_basis'     THEN v_company.acts_on_basis     IS DISTINCT FROM new_acts_on_basis
       WHEN 'bank_account'      THEN v_company.bank_account      IS DISTINCT FROM new_bank_account
       WHEN 'bank_name'         THEN v_company.bank_name         IS DISTINCT FROM new_bank_name
       WHEN 'bank_code'         THEN v_company.bank_code         IS DISTINCT FROM new_bank_code
       WHEN 'email'             THEN v_company.email             IS DISTINCT FROM new_email
       WHEN 'phone'             THEN v_company.phone             IS DISTINCT FROM new_phone
       ELSE false END
     ORDER BY field), '{}'::text[]);

  v_conflicts := COALESCE(ARRAY(
    SELECT DISTINCT field FROM unnest(v_conflicts) AS field
     WHERE CASE field
       WHEN 'full_name'         THEN v_company.full_name         IS DISTINCT FROM n_full_name
       WHEN 'short_name'        THEN v_company.short_name        IS DISTINCT FROM n_short_name
       WHEN 'legal_form'        THEN v_company.legal_form        IS DISTINCT FROM n_legal_form
       WHEN 'legal_address'     THEN v_company.legal_address     IS DISTINCT FROM n_legal_address
       WHEN 'director_name'     THEN v_company.director_name     IS DISTINCT FROM n_director_name
       WHEN 'director_position' THEN v_company.director_position IS DISTINCT FROM n_director_position
       WHEN 'acts_on_basis'     THEN v_company.acts_on_basis     IS DISTINCT FROM n_acts_on_basis
       WHEN 'bank_account'      THEN v_company.bank_account      IS DISTINCT FROM n_bank_account
       WHEN 'bank_name'         THEN v_company.bank_name         IS DISTINCT FROM n_bank_name
       WHEN 'bank_code'         THEN v_company.bank_code         IS DISTINCT FROM n_bank_code
       WHEN 'email'             THEN v_company.email             IS DISTINCT FROM n_email
       WHEN 'phone'             THEN v_company.phone             IS DISTINCT FROM n_phone
       ELSE false END
     ORDER BY field), '{}'::text[]);

  v_values_hash := md5(jsonb_build_object(
    'source_updated_at', v_cld.updated_at,
    'first_billing_sync', v_first_billing_sync,
    'changed_fields', to_jsonb(v_changed),
    'conflict_fields', to_jsonb(v_conflicts),
    'values', jsonb_build_object(
      'full_name', n_full_name, 'short_name', n_short_name, 'legal_form', n_legal_form,
      'legal_address', n_legal_address, 'director_name', n_director_name,
      'director_position', n_director_position, 'acts_on_basis', n_acts_on_basis,
      'bank_account', n_bank_account, 'bank_name', n_bank_name, 'bank_code', n_bank_code,
      'email', n_email, 'phone', n_phone)
  )::text);
  v_event_key := 'company.upserted_from_billing:' || v_id::text || ':' || _client_legal_details_id::text || ':' ||
                 COALESCE(v_cld.updated_at::text, 'no-source-version') || ':' || v_values_hash;

  IF array_length(v_changed,1) IS NULL AND array_length(v_conflicts,1) IS NULL
     AND NOT v_first_billing_sync
     AND v_prev_src IS NOT NULL
     AND v_cld.updated_at IS NOT DISTINCT FROM v_prev_src THEN
    RETURN v_id;
  END IF;

  -- Единый UPDATE: значения полей + обновление metadata (snapshot + timestamps).
  UPDATE public.companies SET
    full_name         = new_full_name,
    short_name        = new_short_name,
    legal_form        = new_legal_form,
    legal_address     = new_legal_address,
    director_name     = new_director_name,
    director_position = new_director_position,
    acts_on_basis     = new_acts_on_basis,
    bank_account      = new_bank_account,
    bank_name         = new_bank_name,
    bank_code         = new_bank_code,
    email             = new_email,
    phone             = new_phone,
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'company_sync', COALESCE(metadata->'company_sync','{}'::jsonb) || jsonb_build_object(
        'billing_snapshot', v_snap,
        'last_billing_client_legal_details_id', to_jsonb(_client_legal_details_id),
        'last_billing_synced_at', to_jsonb(now()),
        'last_billing_source_updated_at', to_jsonb(v_cld.updated_at)
      )),
    updated_at = now()
  WHERE id = v_id;

  -- override conflicts → crm_activity_log (idempotent per (company, field, cld))
  IF array_length(v_conflicts,1) IS NOT NULL THEN
    INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                         idempotency_key, metadata)
    SELECT 'company.field.override_conflict', v_id, 'company',
           'company.field.override_conflict:' || v_id::text || ':' || f || ':' || _client_legal_details_id::text,
           jsonb_build_object('field', f, 'cld_id', _client_legal_details_id)
      FROM unnest(v_conflicts) AS f
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_activity_log
        WHERE source_entity_type='company' AND source_entity_id=v_id
          AND idempotency_key='company.field.override_conflict:' || v_id::text || ':' || f || ':' || _client_legal_details_id::text);
  END IF;

  -- domain_events только при material change/conflict; idempotency включает source version + normalized values hash.
  IF array_length(v_changed,1) IS NOT NULL OR array_length(v_conflicts,1) IS NOT NULL THEN
    PERFORM public._crm_company_emit_domain_event(
      'company.upserted_from_billing.v1',
      v_id,
      v_event_key,
      jsonb_build_object(
        'version', 1, 'company_id', v_id, 'cld_id', _client_legal_details_id,
        'changed_fields', to_jsonb(v_changed), 'override_conflict_fields', to_jsonb(v_conflicts),
        'source_updated_at', v_cld.updated_at, 'values_hash', v_values_hash,
        'first_billing_sync', v_first_billing_sync,
        'occurred_at', now(),
        'idempotency_key', v_event_key
      )
    );
  END IF;

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.search_companies(_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed_keys text[] := ARRAY['q','status','company_kind','country','profile_id',
                                 'include_merged','limit','offset','sort_by','sort_dir'];
  v_key text;
  v_q text; v_country text; v_profile uuid; v_incl_merged boolean;
  v_limit int; v_offset int; v_sort_by text; v_sort_dir text;
  v_status text[]; v_kind text[];
  v_items jsonb; v_total bigint; v_sql text;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
       OR has_role_v2(v_uid,'menedzher')   OR has_role_v2(v_uid,'support')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF _filters IS NULL THEN _filters := '{}'::jsonb; END IF;
  FOR v_key IN SELECT jsonb_object_keys(_filters) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'unknown filter key: %', v_key USING ERRCODE='22023';
    END IF;
  END LOOP;

  v_q            := NULLIF(btrim(_filters->>'q'),'');
  v_country      := NULLIF(upper(btrim(coalesce(_filters->>'country',''))),'');
  v_profile      := NULLIF(_filters->>'profile_id','')::uuid;
  v_incl_merged  := COALESCE((_filters->>'include_merged')::boolean, false);
  v_limit        := LEAST(GREATEST(COALESCE((_filters->>'limit')::int, 20), 1), 100);
  v_offset       := GREATEST(COALESCE((_filters->>'offset')::int, 0), 0);
  v_sort_by      := COALESCE(_filters->>'sort_by','created_at');
  v_sort_dir     := lower(COALESCE(_filters->>'sort_dir','desc'));
  IF v_sort_by NOT IN ('created_at','full_name','public_id') THEN
    RAISE EXCEPTION 'invalid sort_by' USING ERRCODE='22023'; END IF;
  IF v_sort_dir NOT IN ('asc','desc') THEN
    RAISE EXCEPTION 'invalid sort_dir' USING ERRCODE='22023'; END IF;

  IF jsonb_typeof(_filters->'status') = 'array' THEN
    SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(_filters->'status') AS x;
    IF v_status && ARRAY[]::text[] THEN NULL; END IF;
    IF NOT (v_status <@ ARRAY['active','archived','merged']) THEN
      RAISE EXCEPTION 'invalid status[]' USING ERRCODE='22023'; END IF;
  END IF;
  IF jsonb_typeof(_filters->'company_kind') = 'array' THEN
    SELECT array_agg(x) INTO v_kind FROM jsonb_array_elements_text(_filters->'company_kind') AS x;
    IF NOT (v_kind <@ ARRAY['legal_entity','entrepreneur','foreign','unknown']) THEN
      RAISE EXCEPTION 'invalid company_kind[]' USING ERRCODE='22023'; END IF;
  END IF;

  v_sql := format($f$
    WITH base AS (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized,
             c.country, c.company_kind, c.status, c.email, c.phone, c.created_at
        FROM public.companies c
       WHERE ( $1 OR c.status <> 'merged' )
         AND ( $2::text IS NULL OR c.country = $2 )
         AND ( $3::uuid IS NULL OR EXISTS (
                 SELECT 1 FROM public.company_contacts cc
                  WHERE cc.company_id = c.id AND cc.profile_id = $3 ) )
         AND ( $4::text[] IS NULL OR c.status        = ANY($4) )
         AND ( $5::text[] IS NULL OR c.company_kind  = ANY($5) )
         AND ( $6::text IS NULL
               OR c.public_id      ILIKE '%%'||$6||'%%'
               OR c.full_name      ILIKE '%%'||$6||'%%'
               OR c.short_name     ILIKE '%%'||$6||'%%'
               OR c.unp_normalized ILIKE '%%'||$6||'%%'
               OR c.email          ILIKE '%%'||$6||'%%'
               OR c.phone          ILIKE '%%'||$6||'%%' )
    )
    SELECT jsonb_build_object(
      'items', COALESCE(jsonb_agg(row_to_json(b) ORDER BY %I %s), '[]'::jsonb),
      'total', (SELECT count(*) FROM base),
      'limit', %s, 'offset', %s)
    FROM (SELECT * FROM base ORDER BY %I %s LIMIT %s OFFSET %s) b
  $f$, v_sort_by, v_sort_dir, v_limit, v_offset, v_sort_by, v_sort_dir, v_limit, v_offset);

  EXECUTE v_sql
    INTO v_items
    USING v_incl_merged, v_country, v_profile, v_status, v_kind, v_q;

  RETURN v_items;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_merge(_source_id uuid, _target_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_target_leaf       uuid;
  v_src               public.companies%ROWTYPE;
  v_tgt               public.companies%ROWTYPE;
  v_src_public_id     text;
  v_tgt_public_id     text;
  v_moved_map         int := 0;
  v_moved_contacts    int := 0;
  v_merged_contacts   int := 0;
  v_cycle             int;
  v_src_row           public.company_contacts%ROWTYPE;
  v_tgt_row           public.company_contacts%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _source_id = _target_id THEN RAISE EXCEPTION 'source=target' USING ERRCODE='22023'; END IF;

  -- §7.1 разрешение цепочки merged_into для target до листа
  WITH RECURSIVE chain AS (
    SELECT id, merged_into_company_id, status, 1 AS depth
      FROM public.companies WHERE id = _target_id
    UNION ALL
    SELECT c.id, c.merged_into_company_id, c.status, chain.depth + 1
      FROM public.companies c
      JOIN chain ON c.id = chain.merged_into_company_id
      WHERE chain.depth < 32
  )
  SELECT id INTO v_target_leaf FROM chain
   WHERE merged_into_company_id IS NULL AND status <> 'merged'
   LIMIT 1;
  IF v_target_leaf IS NULL THEN
    RAISE EXCEPTION 'target chain broken or cyclic' USING ERRCODE='22023';
  END IF;
  IF v_target_leaf = _source_id THEN
    RAISE EXCEPTION 'target leaf equals source' USING ERRCODE='22023';
  END IF;

  -- §7.2 detection циклов: source не должен лежать в цепочке target
  WITH RECURSIVE chk AS (
    SELECT id, merged_into_company_id, 1 AS depth
      FROM public.companies WHERE id = v_target_leaf
    UNION ALL
    SELECT c.id, c.merged_into_company_id, chk.depth + 1
      FROM public.companies c
      JOIN chk ON c.id = chk.merged_into_company_id
      WHERE chk.depth < 32
  )
  SELECT count(*) INTO v_cycle FROM chk WHERE id = _source_id;
  IF v_cycle > 0 THEN
    RAISE EXCEPTION 'cycle detected: source is ancestor of target' USING ERRCODE='22023';
  END IF;

  -- §7.3 locking — детерминированный порядок LEAST/GREATEST + FOR UPDATE
  PERFORM 1 FROM public.companies
    WHERE id = LEAST(_source_id, v_target_leaf) FOR UPDATE;
  PERFORM 1 FROM public.companies
    WHERE id = GREATEST(_source_id, v_target_leaf) FOR UPDATE;
  PERFORM 1 FROM public.client_legal_details_company_map
    WHERE company_id = _source_id FOR UPDATE;
  PERFORM 1 FROM public.company_contacts
    WHERE company_id = _source_id FOR UPDATE;
  PERFORM 1 FROM public.company_contacts
    WHERE company_id = v_target_leaf FOR UPDATE;

  SELECT * INTO v_src FROM public.companies WHERE id = _source_id;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'source not found' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_tgt FROM public.companies WHERE id = v_target_leaf;
  IF v_tgt.id IS NULL THEN
    RAISE EXCEPTION 'target leaf not found' USING ERRCODE='23503';
  END IF;
  v_src_public_id := v_src.public_id;
  v_tgt_public_id := v_tgt.public_id;

  -- workspace check
  IF v_src.workspace_id <> v_tgt.workspace_id THEN
    RAISE EXCEPTION 'workspace mismatch' USING ERRCODE='22023'; END IF;

  -- idempotency: если source уже merged в v_target_leaf → возврат без событий
  IF v_src.status='merged' AND v_src.merged_into_company_id = v_target_leaf THEN
    RETURN v_target_leaf;
  END IF;
  IF v_src.status='merged' AND v_src.merged_into_company_id <> v_target_leaf THEN
    RAISE EXCEPTION 'source already merged into different target' USING ERRCODE='22023';
  END IF;
  IF v_tgt.status='merged' THEN
    RAISE EXCEPTION 'target is merged' USING ERRCODE='22023';
  END IF;

  -- §7.4 перенос map (уникальный ключ = client_legal_details_id; конфликтов не создаёт).
  WITH m AS (
    UPDATE public.client_legal_details_company_map
       SET company_id = v_target_leaf, updated_at = now(), updated_by = auth.uid()
     WHERE company_id = _source_id
     RETURNING 1)
  SELECT count(*) INTO v_moved_map FROM m;

  -- §7.5 перенос contacts — строгий row-by-row алгоритм.
  FOR v_src_row IN
    SELECT * FROM public.company_contacts
     WHERE company_id = _source_id
     ORDER BY id
  LOOP
    SELECT * INTO v_tgt_row FROM public.company_contacts
     WHERE company_id = v_target_leaf
       AND profile_id = v_src_row.profile_id
       AND relationship_type = v_src_row.relationship_type
     FOR UPDATE;

    IF NOT FOUND THEN
      -- Целевой строки нет → простой перенос.
      UPDATE public.company_contacts
         SET company_id = v_target_leaf,
             updated_at = now(),
             updated_by = auth.uid()
       WHERE id = v_src_row.id;
      v_moved_contacts := v_moved_contacts + 1;
      CONTINUE;
    END IF;

    -- Обе строки существуют → детерминированное объединение.
    UPDATE public.company_contacts SET
      is_billing_contact = v_tgt_row.is_billing_contact OR v_src_row.is_billing_contact,
      is_primary         = v_tgt_row.is_primary         OR v_src_row.is_primary,
      source_client_legal_details_map_id = CASE
        WHEN v_tgt_row.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.client_legal_details_company_map m
           WHERE m.id = v_tgt_row.source_client_legal_details_map_id
             AND m.company_id = v_target_leaf)
          THEN v_tgt_row.source_client_legal_details_map_id
        WHEN v_src_row.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.client_legal_details_company_map m
           WHERE m.id = v_src_row.source_client_legal_details_map_id
             AND m.company_id = v_target_leaf)
          THEN v_src_row.source_client_legal_details_map_id
        ELSE NULL END,
      source = CASE
        WHEN v_tgt_row.source = 'billing_requisites' OR v_src_row.source = 'billing_requisites'
          THEN 'billing_requisites'
        WHEN v_tgt_row.source = 'manual' OR v_src_row.source = 'manual'
          THEN 'manual'
        ELSE COALESCE(v_tgt_row.source, v_src_row.source) END,
      metadata = COALESCE(v_src_row.metadata,'{}'::jsonb)
              || COALESCE(v_tgt_row.metadata,'{}'::jsonb)
              || jsonb_build_object(
                   'merged_from', COALESCE(v_tgt_row.metadata->'merged_from','[]'::jsonb) ||
                                  jsonb_build_array(jsonb_build_object(
                                    'source_contact_id', v_src_row.id,
                                    'source_metadata', COALESCE(v_src_row.metadata,'{}'::jsonb),
                                    'at', now(),
                                    'by', auth.uid()))),
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_tgt_row.id;

    DELETE FROM public.company_contacts WHERE id = v_src_row.id;
    v_merged_contacts := v_merged_contacts + 1;
  END LOOP;

  -- §7.6 объединение metadata на уровне компании и переключение status source.
  UPDATE public.companies SET
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'merge', jsonb_build_object(
        'consumed', COALESCE(metadata->'merge'->'consumed','[]'::jsonb) ||
                    jsonb_build_array(jsonb_build_object(
                      'source_id',        _source_id,
                      'source_public_id', v_src_public_id,
                       'source_status',    v_src.status,
                       'source_metadata',  COALESCE(v_src.metadata,'{}'::jsonb),
                      'at',               now(),
                      'by',               auth.uid()
                    ))
      )
    ),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = v_target_leaf;

  UPDATE public.companies SET
    status = 'merged',
    merged_into_company_id = v_target_leaf,
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'merged', jsonb_build_object(
        'at',   now(),
        'by',   auth.uid(),
        'from', v_src_public_id,
        'into', v_tgt_public_id
      )
    ),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = _source_id AND status <> 'merged';

  -- domain_events через private emit helper
  PERFORM public._crm_company_emit_domain_event(
    'company.merged.v1',
    _source_id,
    'company.merged:'||_source_id::text||':'||v_target_leaf::text,
    jsonb_build_object(
      'version',1,'source_id',_source_id,'source_public_id',v_src_public_id,
      'target_id',v_target_leaf,'target_public_id',v_tgt_public_id,
      'moved_map_rows',v_moved_map,'moved_contact_rows',v_moved_contacts,
      'merged_contact_rows',v_merged_contacts,'occurred_at',now(),'actor_user_id',auth.uid(),
      'idempotency_key','company.merged:'||_source_id::text||':'||v_target_leaf::text
    )
  );

  INSERT INTO public.audit_logs (actor_user_id, action, actor_type, entity_type, entity_id, meta)
  SELECT auth.uid(),'company.merge','user','company',_source_id::text,
         jsonb_build_object('idempotency_key','company.merge:'||_source_id::text||':'||v_target_leaf::text,
                            'target_id',v_target_leaf)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE action='company.merge' AND entity_type='company' AND entity_id=_source_id::text
       AND meta->>'idempotency_key'='company.merge:'||_source_id::text||':'||v_target_leaf::text);

  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                       user_id, idempotency_key, metadata)
  SELECT 'company.merged', _source_id, 'company', auth.uid(),
         'company.merged:'||_source_id::text||':'||v_target_leaf::text,
         jsonb_build_object('target_id',v_target_leaf)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=_source_id
       AND idempotency_key='company.merged:'||_source_id::text||':'||v_target_leaf::text);

  RETURN v_target_leaf;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_archive(_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.companies%ROWTYPE; v_reason text; v_prev_reason text;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  v_reason := NULLIF(btrim(_reason),'');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'reason required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_row FROM public.companies WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='23503'; END IF;
  IF v_row.status='merged' THEN RAISE EXCEPTION 'merged company cannot be archived' USING ERRCODE='22023'; END IF;

  IF v_row.status='archived' THEN
    v_prev_reason := v_row.metadata->'archive'->>'reason';
    IF v_prev_reason IS NOT DISTINCT FROM v_reason THEN
      RETURN _id;  -- идемпотентно
    ELSE
      RAISE EXCEPTION 'company already archived with different reason' USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.companies SET
    status='archived', archived_at=now(),
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'archive', jsonb_build_object('reason', v_reason, 'by', auth.uid(), 'at', now())),
    updated_at=now(), updated_by=auth.uid()
  WHERE id=_id;

  PERFORM public._crm_company_emit_domain_event(
    'company.archived.v1',
    _id,
    'company.archived:'||_id::text||':'||md5(v_reason),
    jsonb_build_object(
      'version',1,'company_id',_id,'reason',v_reason,'occurred_at',now(),'actor_user_id',auth.uid(),
      'idempotency_key','company.archived:'||_id::text||':'||md5(v_reason)
    )
  );

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  SELECT auth.uid(),'company.archive','user','company',_id::text,
         jsonb_build_object('idempotency_key','company.archive:'||_id::text,'reason',v_reason)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE action='company.archive' AND entity_type='company' AND entity_id=_id::text);

  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type,
                                      user_id, idempotency_key, metadata)
  SELECT 'company.archived',_id,'company',auth.uid(),
         'company.archived:'||_id::text, jsonb_build_object('reason',v_reason)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=_id
       AND idempotency_key='company.archived:'||_id::text);

  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_grp_refetch(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.companies%ROWTYPE; v_existing uuid; v_new uuid; v_key text;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.companies WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='23503'; END IF;
  IF v_row.status <> 'active' THEN RAISE EXCEPTION 'company not active' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('company_grp_refetch:'||_id::text, 0));

  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_type='company' AND entity_id=_id
     AND run_reason='grp_refetch'
     AND status IN ('queued','running')
   FOR UPDATE;

  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_key := 'company:'||_id::text||':grp_refetch:'||gen_random_uuid()::text;
  INSERT INTO public.company_sync_queue(entity_type, entity_id, run_reason, status,
                                        idempotency_key, next_run_at, payload, created_by, updated_by)
  VALUES ('company', _id, 'grp_refetch', 'queued', v_key, now(), '{}'::jsonb, auth.uid(), auth.uid())
  RETURNING id INTO v_new;

  PERFORM public._crm_company_emit_domain_event(
    'company.grp_refetch_requested.v1',
    _id,
    'company.grp_refetch_requested:'||v_new::text,
    jsonb_build_object(
      'version',1,'company_id',_id,'queue_id',v_new,
      'idempotency_key','company.grp_refetch_requested:'||v_new::text,
      'occurred_at',now(),'actor_user_id',auth.uid()
    )
  );

  RETURN v_new;
END $$;
CREATE OR REPLACE FUNCTION public.search_global(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts  jsonb;
  v_deals     jsonb;
  v_messages  jsonb;
  v_companies jsonb;
  v_user_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_user_id, 'admin'::app_role)
    OR public.has_role(v_user_id, 'superadmin'::app_role)
    OR public.has_permission(v_user_id, 'users.view')
    OR public.has_admin_section_access(v_user_id, 'contacts', 'view')
    OR public.has_admin_section_access(v_user_id, 'deals', 'view')
    OR public.has_admin_section_access(v_user_id, 'communication', 'view')
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT p.id as profile_id, p.full_name, p.email, p.phone,
           p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple',
      coalesce(p.full_name, '') || ' ' ||
      coalesce(p.email, '') || ' ' ||
      coalesce(p.phone, '') || ' ' ||
      coalesce(p.telegram_username, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_deals
  FROM (
    SELECT o.id as order_id, o.order_number, o.status::text, o.profile_id,
           o.customer_email, o.customer_phone, p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE to_tsvector('simple',
      coalesce(o.order_number, '') || ' ' ||
      coalesce(o.customer_email, '') || ' ' ||
      coalesce(o.customer_phone, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages
  FROM (
    SELECT
      tm.id,
      'private'::text as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,
      NULL::bigint as chat_id,
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE to_tsvector('simple', coalesce(tm.message_text, ''))
          @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) m;

  -- Additive Phase 2 branch: companies (собственный role guard, без расширения доступа других веток)
  IF (
    public.has_role_v2(v_user_id, 'super_admin') OR public.has_role_v2(v_user_id, 'admin') OR
    public.has_role_v2(v_user_id, 'menedzher')   OR public.has_role_v2(v_user_id, 'support')
  ) THEN
    SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_companies
    FROM (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized,
             c.country, c.company_kind, c.status, 'company'::text AS entity
      FROM public.companies c
      WHERE c.status <> 'merged'
        AND (c.public_id      ILIKE '%'||p_query||'%'
          OR c.full_name      ILIKE '%'||p_query||'%'
          OR c.short_name     ILIKE '%'||p_query||'%'
          OR c.unp_normalized ILIKE '%'||p_query||'%')
      LIMIT p_limit OFFSET p_offset
    ) c;
  ELSE
    v_companies := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'contacts',  v_contacts,
    'deals',     v_deals,
    'messages',  v_messages,
    'companies', v_companies
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.search_companies(jsonb)                                     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_merge(uuid,uuid)                                FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_archive(uuid,text)                              FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_grp_refetch(uuid)                               FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_upsert_from_billing(uuid)                       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_companies(jsonb)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_merge(uuid,uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_archive(uuid,text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_grp_refetch(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_upsert_from_billing(uuid)                       TO service_role;

-- Оба private helper — никаких GRANT
REVOKE ALL ON FUNCTION public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_company_emit_domain_event(text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DO $post$
DECLARE v_hash text;
BEGIN
  -- baseline hash unchanged
  SELECT md5(string_agg(table_name || ':' || column_name || ':' || data_type,
                        ',' ORDER BY table_name, ordinal_position))
    INTO v_hash
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('client_legal_details','profiles','public_id_sequences','roles',
                        'role_admin_resource_access','role_admin_section_access','admin_section');
  IF v_hash <> 'c41160b83c8e15c3d3c41a13028700d5' THEN
    RAISE EXCEPTION 'post: baseline hash drift %', v_hash;
  END IF;

  -- ACL matrix: expected 6 authenticated RPC, 1 service-only RPC, 2 private helpers, preserved search_global.
  IF NOT has_function_privilege('authenticated','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.search_companies(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_archive(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_grp_refetch(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: authenticated RPC grants missing'; END IF;

  IF has_function_privilege('anon','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.search_companies(jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_archive(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_grp_refetch(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.search_companies(jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_archive(uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_grp_refetch(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: unexpected anon/service_role grants on authenticated RPC'; END IF;

  IF NOT has_function_privilege('service_role','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: billing RPC ACL drift'; END IF;

  IF has_function_privilege('anon','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'post: private helper ACL drift'; END IF;

  -- search_global ACL must stay executable for anon/authenticated/service_role per pre-Phase-2 contract.
  IF NOT has_function_privilege('anon','public.search_global(text,integer,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.search_global(text,integer,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.search_global(text,integer,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'post: search_global ACL drift from pre-Phase-2 contract'; END IF;

  -- emit helper exists и SECURITY DEFINER
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_crm_company_emit_domain_event' AND p.prosecdef;
  IF NOT FOUND THEN RAISE EXCEPTION 'post: emit helper missing or not SECURITY DEFINER'; END IF;

  -- shared-таблица domain_events НЕ должна иметь Phase 2 индексов
  PERFORM 1 FROM pg_indexes
   WHERE schemaname='public' AND tablename='domain_events'
     AND indexname LIKE '%company_idem%';
  IF FOUND THEN RAISE EXCEPTION 'post: unexpected Phase 2 index on domain_events'; END IF;
END $post$;

COMMIT;
