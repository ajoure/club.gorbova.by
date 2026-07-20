-- Companies Phase 10D: company-owned notes in the same unified feed as contacts.
-- Notes are deliberately separate from contact_notes: a director/comment imported
-- from a source sheet belongs to the company and must not create a contact profile.

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

CREATE INDEX IF NOT EXISTS idx_company_notes_company_created
  ON public.company_notes (company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_notes_source_key
  ON public.company_notes (company_id, source, source_key)
  WHERE source_key IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_notes TO authenticated;
GRANT ALL ON public.company_notes TO service_role;
ALTER TABLE public.company_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_notes_staff_read" ON public.company_notes;
CREATE POLICY "company_notes_staff_read" ON public.company_notes
FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'employee')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "company_notes_staff_insert" ON public.company_notes;
CREATE POLICY "company_notes_staff_insert" ON public.company_notes
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    public.has_role_v2(auth.uid(),'employee')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'super_admin')
  )
);

DROP POLICY IF EXISTS "company_notes_owner_or_admin_update" ON public.company_notes;
CREATE POLICY "company_notes_owner_or_admin_update" ON public.company_notes
FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
)
WITH CHECK (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "company_notes_owner_or_admin_delete" ON public.company_notes;
CREATE POLICY "company_notes_owner_or_admin_delete" ON public.company_notes
FOR DELETE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
);

CREATE OR REPLACE FUNCTION public.company_notes_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_notes_updated_at ON public.company_notes;
CREATE TRIGGER trg_company_notes_updated_at
BEFORE UPDATE ON public.company_notes
FOR EACH ROW EXECUTE FUNCTION public.company_notes_touch_updated_at();

CREATE OR REPLACE FUNCTION public.company_note_create(
  _company_id uuid,
  _body text,
  _source text DEFAULT 'manual',
  _source_key text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_source text := COALESCE(NULLIF(btrim(_source), ''), 'manual');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.has_role_v2(v_uid,'employee')
    OR public.has_role_v2(v_uid,'admin')
    OR public.has_role_v2(v_uid,'super_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _company_id) THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE='22023';
  END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN
    RAISE EXCEPTION 'empty_body' USING ERRCODE='22023';
  END IF;

  IF _source_key IS NOT NULL AND length(btrim(_source_key)) > 0 THEN
    SELECT n.id INTO v_id
      FROM public.company_notes n
     WHERE n.company_id = _company_id
       AND n.source = v_source
       AND n.source_key = btrim(_source_key)
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.company_notes (company_id, author_id, body, source, source_key, metadata)
  VALUES (_company_id, v_uid, btrim(_body), v_source, NULLIF(btrim(_source_key), ''), COALESCE(_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_note_create(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_note_create(uuid, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.company_note_delete(_note_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_author uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT n.author_id INTO v_author FROM public.company_notes n WHERE n.id = _note_id;
  IF v_author IS NULL THEN RETURN false; END IF;
  IF v_author <> v_uid AND NOT public.has_role_v2(v_uid,'admin') AND NOT public.has_role_v2(v_uid,'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.company_notes WHERE id = _note_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_note_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_note_delete(uuid) TO authenticated, service_role;

-- Extend the existing company feed without changing the contact entity or its feed.
CREATE OR REPLACE FUNCTION public.company_feed_list(
  _company_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := GREATEST(1, LEAST(COALESCE(_limit, 200) + GREATEST(COALESCE(_offset, 0), 0), 500));
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher') OR has_role_v2(v_uid, 'support')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  WITH contact_items AS (
    SELECT item || jsonb_build_object('source', 'contact') AS item
      FROM public.company_contacts cc
      CROSS JOIN LATERAL jsonb_array_elements(
        public.contact_feed_list(cc.profile_id, _types, _search, v_limit, 0)
      ) item
     WHERE cc.company_id = _company_id
       AND cc.profile_id IS NOT NULL
  ),
  company_notes AS (
    SELECT jsonb_build_object(
      'id', n.id::text,
      'kind', 'note',
      'at', n.created_at,
      'title', 'Заметка',
      'body', n.body,
      'meta', jsonb_build_object(
        'author_id', n.author_id,
        'source', n.source,
        'source_key', n.source_key,
        'metadata', n.metadata,
        'can_delete', (n.author_id = v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin'))
      ),
      'author', (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = n.author_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.company_notes n
     WHERE n.company_id = _company_id
       AND (_types IS NULL OR 'note' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(n.body) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_tasks AS (
    SELECT jsonb_build_object(
      'id', t.id::text, 'kind', 'task', 'at', COALESCE(t.due_at, t.created_at),
      'title', t.title, 'body', t.description,
      'meta', jsonb_build_object('public_id', t.public_id, 'status', t.status, 'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id, 'closed_at', t.closed_at, 'task_type_id', t.task_type_id),
      'author', NULL, 'source', 'company'
    ) AS item
      FROM public.crm_tasks t
     WHERE t.company_id = _company_id
       AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = _company_id AND cc.profile_id IS NOT NULL AND cc.profile_id = t.contact_id)
       AND (_types IS NULL OR 'task' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(coalesce(t.title,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(t.description,'')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_events AS (
    SELECT jsonb_build_object(
      'id', a.id::text, 'kind', 'event', 'at', a.created_at,
      'title', COALESCE(a.title_snapshot, a.activity_type), 'body', a.text_snapshot,
      'meta', jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type,
        'source_entity_id', a.source_entity_id, 'live_event_id', a.live_event_id),
      'author', a.author_snapshot, 'source', 'company'
    ) AS item
      FROM public.crm_activity_log a
     WHERE a.source_entity_type = 'company' AND a.source_entity_id = _company_id
       AND (_types IS NULL OR 'event' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(coalesce(a.title_snapshot,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(a.text_snapshot,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(a.activity_type,'')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  all_items AS (
    SELECT item FROM contact_items
    UNION ALL SELECT item FROM company_notes
    UNION ALL SELECT item FROM company_tasks
    UNION ALL SELECT item FROM company_events
  ),
  ordered AS (
    SELECT item FROM all_items
    ORDER BY (item->>'at')::timestamptz DESC NULLS LAST, item->>'id'
    LIMIT v_limit OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'at')::timestamptz DESC NULLS LAST), '[]'::jsonb)
    INTO v_result FROM ordered;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_feed_list(uuid, text[], text, int, int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.company_feed_list(uuid, text[], text, int, int) TO authenticated;
