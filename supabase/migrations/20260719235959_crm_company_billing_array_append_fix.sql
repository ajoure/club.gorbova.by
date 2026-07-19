BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'crm_company_upsert_from_billing'
     AND pg_get_function_identity_arguments(p.oid) = '_client_legal_details_id uuid'
     AND p.prosecdef;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'billing corrective preflight: expected SECURITY DEFINER function missing or drifted';
  END IF;
END
$pre$;

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
  v_activity_user_id uuid;
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

  SELECT COALESCE(p.user_id, p.id)
    INTO v_activity_user_id
    FROM public.profiles p
   WHERE p.id = v_cld.profile_id;
  IF v_activity_user_id IS NULL THEN
    RAISE EXCEPTION 'billing profile not found' USING ERRCODE='23503';
  END IF;

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

  -- Auto-created billing companies must appear in the CRM timeline. The source
  -- profile supplies the mandatory crm_activity_log.user_id for service-role calls.
  IF v_company.metadata->>'created_source' = 'billing_requisites' THEN
    INSERT INTO public.crm_activity_log (
      activity_type, source_entity_id, source_entity_type,
      user_id, idempotency_key, metadata
    )
    SELECT 'company.created', v_id, 'company', v_activity_user_id,
           'company.created:' || v_id::text,
           jsonb_build_object('source', 'billing_requisites', 'source_cld_id', _client_legal_details_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.crm_activity_log
       WHERE source_entity_type='company' AND source_entity_id=v_id
         AND idempotency_key='company.created:' || v_id::text
    );
  END IF;

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
      v_changed := array_append(v_changed, 'full_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{full_name}', to_jsonb(n_full_name));
      v_conflicts := array_append(v_conflicts, 'full_name');
    END IF;
  END IF;

  -- short_name
  IF n_short_name IS NOT NULL THEN
    IF v_company.short_name IS NULL
       OR v_company.short_name IS NOT DISTINCT FROM (v_snap->>'short_name') THEN
      new_short_name := n_short_name;
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_changed := array_append(v_changed, 'short_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_conflicts := array_append(v_conflicts, 'short_name');
    END IF;
  END IF;

  -- legal_form
  IF n_legal_form IS NOT NULL THEN
    IF v_company.legal_form IS NULL
       OR v_company.legal_form IS NOT DISTINCT FROM (v_snap->>'legal_form') THEN
      new_legal_form := n_legal_form;
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_changed := array_append(v_changed, 'legal_form');
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_conflicts := array_append(v_conflicts, 'legal_form');
    END IF;
  END IF;

  -- legal_address
  IF n_legal_address IS NOT NULL THEN
    IF v_company.legal_address IS NULL
       OR v_company.legal_address IS NOT DISTINCT FROM (v_snap->>'legal_address') THEN
      new_legal_address := n_legal_address;
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_changed := array_append(v_changed, 'legal_address');
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_conflicts := array_append(v_conflicts, 'legal_address');
    END IF;
  END IF;

  -- director_name
  IF n_director_name IS NOT NULL THEN
    IF v_company.director_name IS NULL
       OR v_company.director_name IS NOT DISTINCT FROM (v_snap->>'director_name') THEN
      new_director_name := n_director_name;
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_changed := array_append(v_changed, 'director_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_conflicts := array_append(v_conflicts, 'director_name');
    END IF;
  END IF;

  -- director_position
  IF n_director_position IS NOT NULL THEN
    IF v_company.director_position IS NULL
       OR v_company.director_position IS NOT DISTINCT FROM (v_snap->>'director_position') THEN
      new_director_position := n_director_position;
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_changed := array_append(v_changed, 'director_position');
    ELSE
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_conflicts := array_append(v_conflicts, 'director_position');
    END IF;
  END IF;

  -- acts_on_basis
  IF n_acts_on_basis IS NOT NULL THEN
    IF v_company.acts_on_basis IS NULL
       OR v_company.acts_on_basis IS NOT DISTINCT FROM (v_snap->>'acts_on_basis') THEN
      new_acts_on_basis := n_acts_on_basis;
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_changed := array_append(v_changed, 'acts_on_basis');
    ELSE
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_conflicts := array_append(v_conflicts, 'acts_on_basis');
    END IF;
  END IF;

  -- bank_account
  IF n_bank_account IS NOT NULL THEN
    IF v_company.bank_account IS NULL
       OR v_company.bank_account IS NOT DISTINCT FROM (v_snap->>'bank_account') THEN
      new_bank_account := n_bank_account;
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_changed := array_append(v_changed, 'bank_account');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_conflicts := array_append(v_conflicts, 'bank_account');
    END IF;
  END IF;

  -- bank_name
  IF n_bank_name IS NOT NULL THEN
    IF v_company.bank_name IS NULL
       OR v_company.bank_name IS NOT DISTINCT FROM (v_snap->>'bank_name') THEN
      new_bank_name := n_bank_name;
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_changed := array_append(v_changed, 'bank_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_conflicts := array_append(v_conflicts, 'bank_name');
    END IF;
  END IF;

  -- bank_code
  IF n_bank_code IS NOT NULL THEN
    IF v_company.bank_code IS NULL
       OR v_company.bank_code IS NOT DISTINCT FROM (v_snap->>'bank_code') THEN
      new_bank_code := n_bank_code;
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_changed := array_append(v_changed, 'bank_code');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_conflicts := array_append(v_conflicts, 'bank_code');
    END IF;
  END IF;

  -- email
  IF n_email IS NOT NULL THEN
    IF v_company.email IS NULL
       OR v_company.email IS NOT DISTINCT FROM (v_snap->>'email') THEN
      new_email := n_email;
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_changed := array_append(v_changed, 'email');
    ELSE
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_conflicts := array_append(v_conflicts, 'email');
    END IF;
  END IF;

  -- phone
  IF n_phone IS NOT NULL THEN
    IF v_company.phone IS NULL
       OR v_company.phone IS NOT DISTINCT FROM (v_snap->>'phone') THEN
      new_phone := n_phone;
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_changed := array_append(v_changed, 'phone');
    ELSE
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_conflicts := array_append(v_conflicts, 'phone');
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
                                         user_id, idempotency_key, metadata)
    SELECT 'company.field.override_conflict', v_id, 'company', v_activity_user_id,
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

REVOKE ALL ON FUNCTION public.crm_company_upsert_from_billing(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_upsert_from_billing(uuid)
  TO service_role;

DO $post$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'crm_company_upsert_from_billing'
     AND pg_get_function_identity_arguments(p.oid) = '_client_legal_details_id uuid'
     AND p.prosecdef;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'billing corrective post-check: function missing or not SECURITY DEFINER';
  END IF;

  IF position('v_changed := v_changed || ' in v_def) > 0
     OR position('v_conflicts := v_conflicts || ' in v_def) > 0 THEN
    RAISE EXCEPTION 'billing corrective post-check: ambiguous scalar array concatenation remains';
  END IF;

  IF position('array_append(v_changed, ' in v_def) = 0
     OR position('array_append(v_conflicts, ' in v_def) = 0 THEN
    RAISE EXCEPTION 'billing corrective post-check: array_append guards missing';
  END IF;

  IF NOT has_function_privilege('service_role',
         'public.crm_company_upsert_from_billing(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
         'public.crm_company_upsert_from_billing(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
         'public.crm_company_upsert_from_billing(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'billing corrective post-check: ACL drift';
  END IF;
END
$post$;

COMMIT;
