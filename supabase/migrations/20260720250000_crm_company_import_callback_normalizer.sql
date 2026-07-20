-- Companies follow-up: accept the callback_at formats present in the source sheet.
-- Existing ISO/timestamptz values keep their previous semantics. Dot/slash dates
-- are interpreted in Europe/Minsk at 09:00, with a missing year using the
-- current Minsk calendar year.

CREATE OR REPLACE FUNCTION public.crm_company_parse_callback_at(_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v text := nullif(btrim(_value), '');
  m text[];
  v_year integer;
  v_date date;
  v_hour integer;
  v_minute integer;
  v_second integer;
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN ((v || ' 09:00:00')::timestamp AT TIME ZONE 'Europe/Minsk');
  END IF;

  -- Preserve existing support for ISO timestamps and explicit offsets.
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ]' THEN
    RETURN v::timestamptz;
  END IF;

  m := regexp_match(
    v,
    '^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$'
  );
  IF m IS NULL THEN
    RAISE EXCEPTION 'invalid callback_at format: %', _value USING ERRCODE = '22007';
  END IF;

  v_year := CASE
    WHEN m[3] IS NULL THEN extract(year FROM timezone('Europe/Minsk', now()))::integer
    WHEN length(m[3]) = 2 THEN 2000 + m[3]::integer
    ELSE m[3]::integer
  END;
  v_date := make_date(v_year, m[2]::integer, m[1]::integer);
  v_hour := coalesce(m[4]::integer, 9);
  v_minute := coalesce(m[5]::integer, 0);
  v_second := coalesce(m[6]::integer, 0);

  IF v_hour > 23 OR v_minute > 59 OR v_second > 59 THEN
    RAISE EXCEPTION 'invalid callback_at time: %', _value USING ERRCODE = '22007';
  END IF;

  RETURN ((v_date::timestamp + make_time(v_hour, v_minute, v_second)) AT TIME ZONE 'Europe/Minsk');
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_parse_callback_at(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_parse_callback_at(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_company_sheet_import_batch_apply(
  _batch_id uuid,
  _assignee_name text DEFAULT 'Полина Асманта',
  _max_rows integer DEFAULT 100,
  _confirm boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_batch public.company_import_batches%ROWTYPE;
  v_assignee uuid;
  v_assignee_count integer;
  v_limit integer := greatest(1, least(coalesce(_max_rows, 100), 100));
  v_row jsonb;
  v_ord bigint;
  v_processed integer := 0;
  v_source_key text;
  v_source text;
  v_row_number integer;
  v_name text;
  v_short_name text;
  v_country text;
  v_kind text;
  v_unp text;
  v_email text;
  v_phone text;
  v_phones jsonb;
  v_emails jsonb;
  v_provider text;
  v_external_id text;
  v_external_match uuid;
  v_existing public.companies%ROWTYPE;
  v_company_id uuid;
  v_task_id uuid;
  v_note_id uuid;
  v_person_id uuid;
  v_lpr jsonb;
  v_callback_text text;
  v_due_at timestamptz;
  v_retrying_error boolean := false;
  v_match_count integer;
  v_reason text;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(_confirm, false) THEN
    RAISE EXCEPTION 'approval_required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_batch FROM public.company_import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='23503'; END IF;
  IF v_batch.status = 'cancelled' THEN
    RETURN jsonb_build_object('batch_id', _batch_id, 'status', v_batch.status, 'processed', 0, 'writes', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_batch.rows) r
     WHERE nullif(btrim(r->>'callback_at'), '') IS NOT NULL
  ) THEN
    SELECT count(*), (array_agg(p.user_id ORDER BY p.user_id))[1] INTO v_assignee_count, v_assignee
      FROM public.profiles p
     WHERE lower(btrim(coalesce(p.full_name, ''))) = lower(btrim(coalesce(_assignee_name, '')))
       AND p.user_id IS NOT NULL;
    IF v_assignee_count <> 1 THEN
      RAISE EXCEPTION 'assignee_must_resolve_to_one_profile: %', coalesce(_assignee_name, '') USING ERRCODE='22023';
    END IF;
  END IF;

  v_source := v_batch.source || ':' || v_batch.source_reference;
  UPDATE public.company_import_batches
     SET status = 'running', approved_by = coalesce(approved_by, v_uid), approved_at = coalesce(approved_at, now())
   WHERE id = _batch_id;

  FOR v_row, v_ord IN
    SELECT value, ordinality
      FROM jsonb_array_elements(v_batch.rows) WITH ORDINALITY
     WHERE (
       (v_batch.status = 'completed' AND EXISTS (
          SELECT 1
            FROM public.company_import_ledger l
           WHERE l.source = v_source
             AND l.source_key = coalesce(nullif(btrim(value->>'source_key'), ''), 'row:' || ordinality::text)
             AND l.status = 'error'
       ))
       OR (v_batch.status <> 'completed'
           AND ordinality > v_batch.cursor_position
           AND ordinality <= v_batch.cursor_position + v_limit)
     )
     ORDER BY ordinality
  LOOP
    v_processed := v_processed + 1;
    v_existing := NULL;
    v_external_match := NULL;
    v_company_id := NULL;
    v_task_id := NULL;
    v_note_id := NULL;
    v_person_id := NULL;
    v_source_key := nullif(btrim(v_row->>'source_key'), '');
    IF v_source_key IS NULL THEN v_source_key := 'row:' || v_ord::text; END IF;
    v_row_number := coalesce(nullif(v_row->>'row_number','')::integer, v_ord::integer);

    v_retrying_error := false;
    SELECT coalesce(l.status = 'error', false)
      INTO v_retrying_error
      FROM public.company_import_ledger l
     WHERE l.source = v_source AND l.source_key = v_source_key;

    IF EXISTS (
      SELECT 1
        FROM public.company_import_ledger l
       WHERE l.source = v_source
         AND l.source_key = v_source_key
         AND l.status <> 'error'
    ) THEN
      UPDATE public.company_import_batches SET skipped_rows = skipped_rows + 1, cursor_position = v_batch.cursor_position + v_processed WHERE id = _batch_id;
      CONTINUE;
    END IF;

    BEGIN
      v_name := nullif(btrim(v_row->>'name'), '');
      v_short_name := nullif(btrim(v_row->>'short_name'), '');
      v_country := upper(coalesce(nullif(btrim(v_row->>'country'), ''), 'BY'));
      v_kind := CASE WHEN lower(coalesce(v_row->>'company_kind','')) IN ('entrepreneur','ip','ип') THEN 'entrepreneur' ELSE 'legal_entity' END;
      v_unp := regexp_replace(coalesce(v_row->>'unp',''), '\D', '', 'g');
      IF length(v_unp) <> 9 THEN v_unp := NULL; END IF;
      v_email := nullif(lower(btrim(v_row->>'email')), '');
      v_phone := nullif(btrim(v_row->>'phone'), '');
      v_phones := CASE WHEN jsonb_typeof(v_row->'phones') = 'array' THEN v_row->'phones' ELSE '[]'::jsonb END;
      v_emails := CASE WHEN jsonb_typeof(v_row->'emails') = 'array' THEN v_row->'emails' ELSE '[]'::jsonb END;
      IF v_phone IS NULL AND jsonb_array_length(v_phones) > 0 THEN v_phone := nullif(btrim(v_phones->>0), ''); END IF;
      IF v_email IS NULL AND jsonb_array_length(v_emails) > 0 THEN v_email := nullif(lower(btrim(v_emails->>0)), ''); END IF;
      v_provider := lower(coalesce(nullif(btrim(v_row->>'external_provider'), ''), 'amocrm'));
      v_external_id := nullif(btrim(v_row->>'external_id'), '');

      IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;
      IF v_unp IS NOT NULL THEN
        SELECT count(*) INTO v_match_count FROM public.companies c
         WHERE c.country = v_country AND c.unp_normalized = v_unp AND c.status <> 'merged';
        IF v_match_count > 1 THEN RAISE EXCEPTION 'conflicting_unp_match'; END IF;
        SELECT * INTO v_existing FROM public.companies c
         WHERE c.country = v_country AND c.unp_normalized = v_unp AND c.status <> 'merged'
         ORDER BY c.created_at, c.id LIMIT 1 FOR UPDATE;
      END IF;
      IF v_existing.id IS NULL AND v_external_id IS NOT NULL THEN
        SELECT e.company_id INTO v_external_match FROM public.company_external_ids e
         WHERE e.provider = v_provider AND e.external_id = v_external_id LIMIT 1;
        IF v_external_match IS NOT NULL THEN SELECT * INTO v_existing FROM public.companies WHERE id = v_external_match FOR UPDATE; END IF;
      END IF;
      IF v_existing.id IS NULL AND v_email IS NOT NULL THEN
        SELECT count(*) INTO v_match_count FROM public.companies c WHERE lower(c.full_name)=lower(v_name) AND lower(c.email)=v_email AND c.status <> 'merged';
        IF v_match_count > 1 THEN RAISE EXCEPTION 'conflicting_email_match'; END IF;
        SELECT * INTO v_existing FROM public.companies c WHERE lower(c.full_name)=lower(v_name) AND lower(c.email)=v_email AND c.status <> 'merged' LIMIT 1 FOR UPDATE;
      END IF;
      IF v_existing.id IS NULL AND v_phone IS NOT NULL THEN
        SELECT count(*) INTO v_match_count FROM public.companies c WHERE lower(c.full_name)=lower(v_name) AND c.phone=v_phone AND c.status <> 'merged';
        IF v_match_count > 1 THEN RAISE EXCEPTION 'conflicting_phone_match'; END IF;
        SELECT * INTO v_existing FROM public.companies c WHERE lower(c.full_name)=lower(v_name) AND c.phone=v_phone AND c.status <> 'merged' LIMIT 1 FOR UPDATE;
      END IF;

      IF v_existing.id IS NULL THEN
        INSERT INTO public.companies(
          workspace_id, company_kind, country, unp_normalized, full_name, short_name,
          email, phone, legal_form, legal_address, director_name, director_position,
          acts_on_basis, bank_account, bank_name, bank_code, metadata, created_by, updated_by
        ) VALUES (
          '00000000-0000-0000-0000-000000000001'::uuid, v_kind, v_country, v_unp, v_name, v_short_name,
          v_email, v_phone, nullif(v_row->>'legal_form',''), nullif(v_row->>'legal_address',''),
          nullif(v_row->>'director_name',''), nullif(v_row->>'director_position',''), nullif(v_row->>'acts_on_basis',''),
          nullif(v_row->>'bank_account',''), nullif(v_row->>'bank_name',''), nullif(v_row->>'bank_code',''),
          jsonb_build_object('google_sheet_import', jsonb_build_object('source_key', v_source_key, 'row_number', v_row_number, 'phones', v_phones, 'emails', v_emails)),
          v_uid, v_uid
        ) RETURNING id INTO v_company_id;
      ELSE
        v_company_id := v_existing.id;
        UPDATE public.companies SET
          short_name = coalesce(short_name, v_short_name), unp_normalized = coalesce(unp_normalized, v_unp),
          email = coalesce(email, v_email), phone = coalesce(phone, v_phone),
          legal_form = coalesce(legal_form, nullif(v_row->>'legal_form','')),
          legal_address = coalesce(legal_address, nullif(v_row->>'legal_address','')),
          director_name = coalesce(director_name, nullif(v_row->>'director_name','')),
          director_position = coalesce(director_position, nullif(v_row->>'director_position','')),
          acts_on_basis = coalesce(acts_on_basis, nullif(v_row->>'acts_on_basis','')),
          bank_account = coalesce(bank_account, nullif(v_row->>'bank_account','')),
          bank_name = coalesce(bank_name, nullif(v_row->>'bank_name','')),
          bank_code = coalesce(bank_code, nullif(v_row->>'bank_code','')),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('google_sheet_import', jsonb_build_object('source_key', v_source_key, 'row_number', v_row_number, 'phones', v_phones, 'emails', v_emails)),
          updated_by = v_uid, updated_at = now()
        WHERE id = v_company_id;
      END IF;

      IF v_external_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.company_external_ids e WHERE e.provider=v_provider AND e.external_id=v_external_id AND e.company_id<>v_company_id) THEN
          RAISE EXCEPTION 'external_id_conflict';
        END IF;
        INSERT INTO public.company_external_ids(company_id, provider, external_id, metadata, created_by, updated_by)
        VALUES (v_company_id, v_provider, v_external_id, jsonb_build_object('source', v_source, 'source_key', v_source_key), v_uid, v_uid)
        ON CONFLICT (company_id, provider) DO UPDATE SET external_id=excluded.external_id, metadata=excluded.metadata, updated_by=v_uid, updated_at=now();
      END IF;

      IF nullif(btrim(v_row->>'director_name'), '') IS NOT NULL THEN
        v_note_id := public.company_note_create(v_company_id,
          'Руководитель: ' || btrim(v_row->>'director_name') || coalesce(E'\nДолжность: ' || nullif(btrim(v_row->>'director_position'), ''), ''),
          'google_sheet', v_source_key || ':director', jsonb_build_object('row_number', v_row_number));
      END IF;
      IF nullif(btrim(v_row->>'comments'), '') IS NOT NULL THEN
        v_note_id := public.company_note_create(v_company_id, btrim(v_row->>'comments'), 'google_sheet', v_source_key || ':comment', jsonb_build_object('row_number', v_row_number));
      END IF;

      IF jsonb_typeof(v_row->'lpr_contacts') = 'array' THEN
        FOR v_lpr IN SELECT value FROM jsonb_array_elements(v_row->'lpr_contacts') LOOP
          IF nullif(btrim(v_lpr->>'full_name'), '') IS NULL THEN CONTINUE; END IF;
          SELECT p.id INTO v_person_id FROM public.company_contact_persons p
           WHERE p.source='import' AND p.external_ids->>'source_key' = v_source_key || ':lpr:' || md5(v_lpr::text) LIMIT 1;
          IF v_person_id IS NULL THEN
            INSERT INTO public.company_contact_persons(full_name, job_title, email, phone, source, external_ids, metadata, created_by, updated_by)
            VALUES (btrim(v_lpr->>'full_name'), nullif(btrim(v_lpr->>'job_title'), ''), nullif(lower(btrim(v_lpr->>'email')), ''), nullif(btrim(v_lpr->>'phone'), ''), 'import', jsonb_build_object('source_key', v_source_key || ':lpr:' || md5(v_lpr::text)), jsonb_build_object('source', v_source), v_uid, v_uid)
            RETURNING id INTO v_person_id;
          END IF;
          INSERT INTO public.company_contact_person_links(company_id, person_id, role, source, evidence, metadata, created_by, updated_by)
          VALUES (v_company_id, v_person_id,
            CASE WHEN (v_lpr->>'role') IN ('director','accountant','founder','beneficial_owner','authorized_representative','employee','billing_contact','contract_signatory') THEN v_lpr->>'role' ELSE 'authorized_representative' END,
            'import', jsonb_build_object('source_key', v_source_key, 'row_number', v_row_number), jsonb_build_object('source', v_source), v_uid, v_uid)
          ON CONFLICT (company_id, person_id, role) DO NOTHING;
        END LOOP;
      ELSIF nullif(btrim(v_row->>'lpr_contacts'), '') IS NOT NULL THEN
        v_note_id := public.company_note_create(v_company_id, 'Контакты ЛПР: ' || btrim(v_row->>'lpr_contacts'), 'google_sheet', v_source_key || ':lpr-text', jsonb_build_object('row_number', v_row_number));
      END IF;

      v_callback_text := nullif(btrim(v_row->>'callback_at'), '');
      v_task_id := NULL;
      IF v_callback_text IS NOT NULL THEN
        v_due_at := public.crm_company_parse_callback_at(v_callback_text);
        v_task_id := public.crm_task_create(jsonb_build_object(
          'task_type', 'call', 'title', 'Перезвонить: ' || v_name,
          'description', nullif(v_row->>'comments',''), 'company_id', v_company_id,
          'assignee_user_id', v_assignee, 'due_at', v_due_at, 'source', 'system',
          'meta', jsonb_build_object('source', v_source, 'source_key', v_source_key, 'row_number', v_row_number)
        ));
      END IF;

      INSERT INTO public.company_import_ledger(source, source_key, batch_id, row_number, status, company_id, task_id, metadata)
      VALUES (v_source, v_source_key, _batch_id, v_row_number, 'applied', v_company_id, v_task_id, jsonb_build_object('name', v_name, 'unp', v_unp))
      ON CONFLICT (source, source_key) DO UPDATE SET
        batch_id = excluded.batch_id,
        row_number = excluded.row_number,
        status = 'applied',
        company_id = excluded.company_id,
        task_id = excluded.task_id,
        metadata = excluded.metadata,
        updated_at = now()
       WHERE public.company_import_ledger.status = 'error';
      UPDATE public.company_import_batches SET
        applied_rows = applied_rows + 1,
        error_rows = greatest(error_rows - CASE WHEN v_retrying_error THEN 1 ELSE 0 END, 0),
        cursor_position = v_batch.cursor_position + v_processed
       WHERE id = _batch_id;
    EXCEPTION WHEN OTHERS THEN
      v_reason := left(SQLERRM, 500);
      INSERT INTO public.company_import_ledger(source, source_key, batch_id, row_number, status, metadata)
      VALUES (v_source, v_source_key, _batch_id, v_row_number, CASE WHEN v_reason LIKE '%conflict%' THEN 'conflict' ELSE 'error' END, jsonb_build_object('error', v_reason, 'row', v_row))
      ON CONFLICT (source, source_key) DO UPDATE SET
        batch_id = excluded.batch_id,
        row_number = excluded.row_number,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = now()
       WHERE public.company_import_ledger.status = 'error';
      UPDATE public.company_import_batches SET
        conflict_rows = conflict_rows + CASE WHEN v_reason LIKE '%conflict%' THEN 1 ELSE 0 END,
        error_rows = error_rows + CASE WHEN v_reason LIKE '%conflict%' THEN 0 ELSE 1 END,
        cursor_position = v_batch.cursor_position + v_processed
       WHERE id = _batch_id;
    END;
  END LOOP;

  UPDATE public.company_import_batches
     SET status = CASE WHEN cursor_position >= total_rows THEN 'completed' ELSE 'running' END
   WHERE id = _batch_id;
  SELECT * INTO v_batch FROM public.company_import_batches WHERE id = _batch_id;
  RETURN jsonb_build_object(
    'batch_id', _batch_id, 'status', v_batch.status, 'processed', v_processed,
    'cursor_position', v_batch.cursor_position, 'total_rows', v_batch.total_rows,
    'applied_rows', v_batch.applied_rows, 'skipped_rows', v_batch.skipped_rows,
    'conflict_rows', v_batch.conflict_rows, 'error_rows', v_batch.error_rows,
    'writes', true, 'assignee_user_id', v_assignee
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_sheet_import_batch_apply(uuid,text,integer,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_sheet_import_batch_apply(uuid,text,integer,boolean) TO authenticated;
