
CREATE TABLE IF NOT EXISTS public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_created
  ON public.contact_notes (contact_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_notes TO authenticated;
GRANT ALL ON public.contact_notes TO service_role;
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_notes_staff_read" ON public.contact_notes
FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE POLICY "contact_notes_staff_insert" ON public.contact_notes
FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));

CREATE POLICY "contact_notes_owner_or_admin_delete" ON public.contact_notes
FOR DELETE TO authenticated
USING (author_id = auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE POLICY "contact_notes_owner_update" ON public.contact_notes
FOR UPDATE TO authenticated
USING (author_id = auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'))
WITH CHECK (author_id = auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.contact_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_files_contact_created
  ON public.contact_files (contact_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_files TO authenticated;
GRANT ALL ON public.contact_files TO service_role;
ALTER TABLE public.contact_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_files_staff_read" ON public.contact_files
FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE POLICY "contact_files_staff_insert" ON public.contact_files
FOR INSERT TO authenticated
WITH CHECK (uploader_id = auth.uid() AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));

CREATE POLICY "contact_files_owner_or_admin_delete" ON public.contact_files
FOR DELETE TO authenticated
USING (uploader_id = auth.uid() OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

-- storage.objects policies for contact-files bucket
DROP POLICY IF EXISTS "contact_files_bucket_staff_read" ON storage.objects;
CREATE POLICY "contact_files_bucket_staff_read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'contact-files' AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));

DROP POLICY IF EXISTS "contact_files_bucket_staff_insert" ON storage.objects;
CREATE POLICY "contact_files_bucket_staff_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'contact-files' AND (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')));

DROP POLICY IF EXISTS "contact_files_bucket_staff_delete" ON storage.objects;
CREATE POLICY "contact_files_bucket_staff_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'contact-files' AND (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin') OR owner = auth.uid()));

CREATE OR REPLACE FUNCTION public.contact_notes_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_contact_notes_updated_at ON public.contact_notes;
CREATE TRIGGER trg_contact_notes_updated_at
BEFORE UPDATE ON public.contact_notes
FOR EACH ROW EXECUTE FUNCTION public.contact_notes_touch_updated_at();

CREATE OR REPLACE FUNCTION public.contact_note_create(_contact_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(_uid,'employee') OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _body IS NULL OR length(trim(_body))=0 THEN RAISE EXCEPTION 'empty_body' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contact_notes (contact_id, author_id, body)
  VALUES (_contact_id, _uid, trim(_body)) RETURNING id INTO _id;
  RETURN _id;
END; $function$;
REVOKE ALL ON FUNCTION public.contact_note_create(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_note_create(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_note_delete(_note_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _author uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT author_id INTO _author FROM public.contact_notes WHERE id = _note_id;
  IF _author IS NULL THEN RETURN false; END IF;
  IF _author <> _uid AND NOT public.has_role_v2(_uid,'admin') AND NOT public.has_role_v2(_uid,'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.contact_notes WHERE id = _note_id;
  RETURN true;
END; $function$;
REVOKE ALL ON FUNCTION public.contact_note_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_note_delete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_feed_list(
  _contact_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _q text := NULLIF(trim(coalesce(_search,'')), '');
  _like text := CASE WHEN _q IS NOT NULL THEN '%' || lower(_q) || '%' ELSE NULL END;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(_uid,'employee') OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  WITH
  calls AS (
    SELECT c.id, 'call'::text AS kind, c.started_at AS at,
      COALESCE(c.direction,'call') AS title, c.ai_summary AS body,
      jsonb_build_object(
        'public_id', c.public_id,
        'phone', COALESCE(c.caller_number, c.callee_number),
        'duration', c.duration_seconds,
        'status', c.status,
        'recording_url', c.recording_url,
        'transcript', c.ai_transcript
      ) AS meta, NULL::text AS author
    FROM public.vochi_calls c
    WHERE c.contact_id = _contact_id
      AND (_types IS NULL OR 'call' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(c.ai_summary,'')) LIKE _like OR lower(coalesce(c.ai_transcript,'')) LIKE _like)
  ),
  sms AS (
    SELECT s.id, 'sms'::text AS kind, s.created_at AS at,
      COALESCE(s.direction,'sms') AS title, s.message AS body,
      jsonb_build_object('phone', s.phone, 'status', s.status, 'provider', s.provider) AS meta,
      NULL::text AS author
    FROM public.sms_messages s
    WHERE s.contact_id = _contact_id
      AND (_types IS NULL OR 'sms' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(s.message,'')) LIKE _like)
  ),
  tasks AS (
    SELECT t.id, 'task'::text AS kind, COALESCE(t.due_at, t.created_at) AS at,
      t.title, t.description AS body,
      jsonb_build_object(
        'public_id', t.public_id,
        'status', t.status,
        'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id,
        'closed_at', t.closed_at,
        'task_type_id', t.task_type_id
      ) AS meta, NULL::text AS author
    FROM public.crm_tasks t
    WHERE t.contact_id = _contact_id
      AND (_types IS NULL OR 'task' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(t.title,'')) LIKE _like OR lower(coalesce(t.description,'')) LIKE _like)
  ),
  notes AS (
    SELECT n.id, 'note'::text AS kind, n.created_at AS at,
      'Заметка'::text AS title, n.body,
      jsonb_build_object(
        'author_id', n.author_id,
        'can_delete', (n.author_id = _uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))
      ) AS meta,
      (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = n.author_id LIMIT 1) AS author
    FROM public.contact_notes n
    WHERE n.contact_id = _contact_id
      AND (_types IS NULL OR 'note' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(n.body,'')) LIKE _like)
  ),
  files AS (
    SELECT f.id, 'file'::text AS kind, f.created_at AS at,
      f.name AS title, NULL::text AS body,
      jsonb_build_object(
        'name', f.name, 'url', f.url, 'storage_path', f.storage_path,
        'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
        'uploader_id', f.uploader_id,
        'can_delete', (f.uploader_id = _uid OR public.has_role_v2(_uid,'admin') OR public.has_role_v2(_uid,'super_admin'))
      ) AS meta,
      (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = f.uploader_id LIMIT 1) AS author
    FROM public.contact_files f
    WHERE f.contact_id = _contact_id
      AND (_types IS NULL OR 'file' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(f.name,'')) LIKE _like)
  ),
  events AS (
    SELECT a.id, 'event'::text AS kind, a.created_at AS at,
      COALESCE(a.title_snapshot, a.activity_type) AS title, a.text_snapshot AS body,
      jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type) AS meta,
      a.author_snapshot AS author
    FROM public.crm_activity_log a
    WHERE a.contact_id = _contact_id
      AND (_types IS NULL OR 'event' = ANY(_types))
      AND (_like IS NULL OR lower(coalesce(a.title_snapshot,'')) LIKE _like OR lower(coalesce(a.text_snapshot,'')) LIKE _like)
  ),
  all_events AS (
    SELECT * FROM calls
    UNION ALL SELECT * FROM sms
    UNION ALL SELECT * FROM tasks
    UNION ALL SELECT * FROM notes
    UNION ALL SELECT * FROM files
    UNION ALL SELECT * FROM events
  ),
  ordered AS (
    SELECT * FROM all_events
    ORDER BY at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(_limit, 500))
    OFFSET GREATEST(0, _offset)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'at', at, 'title', title,
    'body', body, 'meta', meta, 'author', author
  )), '[]'::jsonb) INTO _result FROM ordered;

  RETURN _result;
END; $function$;

REVOKE ALL ON FUNCTION public.contact_feed_list(uuid, text[], text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_feed_list(uuid, text[], text, int, int) TO authenticated, service_role;
