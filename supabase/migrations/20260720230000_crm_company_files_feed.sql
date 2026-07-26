-- Companies parity: company-owned files use the same contact-files bucket and
-- feed presentation, while keeping company files out of contact_files.
CREATE TABLE IF NOT EXISTS public.company_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  url text,
  mime_type text,
  size_bytes bigint,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_files_company_created
  ON public.company_files (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_files TO authenticated;
GRANT ALL ON public.company_files TO service_role;
ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_files_staff_read" ON public.company_files;
CREATE POLICY "company_files_staff_read" ON public.company_files
FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'employee')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "company_files_staff_insert" ON public.company_files;
CREATE POLICY "company_files_staff_insert" ON public.company_files
FOR INSERT TO authenticated
WITH CHECK (
  uploader_id = auth.uid()
  AND (
    public.has_role_v2(auth.uid(),'employee')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'super_admin')
  )
);

DROP POLICY IF EXISTS "company_files_owner_or_admin_delete" ON public.company_files;
CREATE POLICY "company_files_owner_or_admin_delete" ON public.company_files
FOR DELETE TO authenticated
USING (
  uploader_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'super_admin')
);

-- Re-declare the company feed with company-owned files included. Linked
-- contact activity remains delegated to the canonical contact feed.
CREATE OR REPLACE FUNCTION public.company_feed_list(
  _company_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
      CROSS JOIN LATERAL jsonb_array_elements(public.contact_feed_list(cc.profile_id, _types, _search, v_limit, 0)) item
     WHERE cc.company_id = _company_id AND cc.profile_id IS NOT NULL
  ),
  company_notes AS (
    SELECT jsonb_build_object(
      'id', n.id::text, 'kind', 'note', 'at', n.created_at, 'title', 'Заметка', 'body', n.body,
      'meta', jsonb_build_object('author_id', n.author_id, 'source', n.source, 'source_key', n.source_key,
        'metadata', n.metadata, 'can_delete', (n.author_id = v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin'))),
      'author', (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = n.author_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.company_notes n
     WHERE n.company_id = _company_id
       AND (_types IS NULL OR 'note' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(n.body) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_files AS (
    SELECT jsonb_build_object(
      'id', f.id::text,
      'kind', CASE WHEN f.mime_type LIKE 'audio/%' AND (f.name ILIKE 'voice%' OR f.name ILIKE '%.webm') THEN 'voice_note' ELSE 'file' END,
      'at', f.created_at, 'title', f.name, 'body', NULL,
      'meta', jsonb_build_object('name', f.name, 'url', f.url, 'storage_path', f.storage_path,
        'mime_type', f.mime_type, 'size_bytes', f.size_bytes, 'uploader_id', f.uploader_id,
        'can_delete', (f.uploader_id = v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')),
        'transcribe_status', f.meta->>'transcribe_status', 'transcript', f.meta->>'transcript', 'summary', f.meta->>'summary'),
      'author', (SELECT COALESCE(pr.full_name, pr.email) FROM public.profiles pr WHERE pr.user_id = f.uploader_id LIMIT 1),
      'source', 'company'
    ) AS item
      FROM public.company_files f
     WHERE f.company_id = _company_id
       AND (_types IS NULL OR 'file' = ANY(_types) OR 'voice_note' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(coalesce(f.name,'')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_tasks AS (
    SELECT jsonb_build_object('id', t.id::text, 'kind', 'task', 'at', COALESCE(t.due_at, t.created_at),
      'title', t.title, 'body', t.description,
      'meta', jsonb_build_object('public_id', t.public_id, 'status', t.status, 'due_at', t.due_at,
        'assignee_user_id', t.assignee_user_id, 'closed_at', t.closed_at, 'task_type_id', t.task_type_id),
      'author', NULL, 'source', 'company') AS item
      FROM public.crm_tasks t
     WHERE t.company_id = _company_id
       AND NOT EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = _company_id AND cc.profile_id IS NOT NULL AND cc.profile_id = t.contact_id)
       AND (_types IS NULL OR 'task' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(coalesce(t.title,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(t.description,'')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  company_events AS (
    SELECT jsonb_build_object('id', a.id::text, 'kind', 'event', 'at', a.created_at,
      'title', COALESCE(a.title_snapshot, a.activity_type), 'body', a.text_snapshot,
      'meta', jsonb_build_object('activity_type', a.activity_type, 'source_entity_type', a.source_entity_type,
        'source_entity_id', a.source_entity_id, 'live_event_id', a.live_event_id),
      'author', a.author_snapshot, 'source', 'company') AS item
      FROM public.crm_activity_log a
     WHERE a.source_entity_type = 'company' AND a.source_entity_id = _company_id
       AND (_types IS NULL OR 'event' = ANY(_types))
       AND (_search IS NULL OR btrim(_search) = '' OR lower(coalesce(a.title_snapshot,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(a.text_snapshot,'')) LIKE '%' || lower(btrim(_search)) || '%' OR lower(coalesce(a.activity_type,'')) LIKE '%' || lower(btrim(_search)) || '%')
  ),
  all_items AS (
    SELECT item FROM contact_items
    UNION ALL SELECT item FROM company_notes
    UNION ALL SELECT item FROM company_files
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
