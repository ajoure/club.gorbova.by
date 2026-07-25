-- Repurpose the discontinued iLex module as the canonical legislation module.
ALTER TABLE public.ilex_documents RENAME TO legal_documents;
ALTER TABLE public.legal_documents RENAME COLUMN ilex_id TO external_id;
ALTER TABLE public.legal_documents RENAME COLUMN saved_by TO created_by;
ALTER TABLE public.legal_documents RENAME COLUMN content TO content_text;

ALTER INDEX IF EXISTS public.idx_ilex_documents_ilex_id
  RENAME TO idx_legal_documents_external_id;
ALTER INDEX IF EXISTS public.idx_ilex_documents_saved_by
  RENAME TO idx_legal_documents_created_by;
ALTER TRIGGER update_ilex_documents_updated_at ON public.legal_documents
  RENAME TO update_legal_documents_updated_at;

ALTER TABLE public.legal_documents
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN slug text,
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN category text NOT NULL DEFAULT 'other',
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN organ text,
  ADD COLUMN effective_at date,
  ADD COLUMN revision_label text,
  ADD COLUMN content_html text,
  ADD COLUMN structure jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN checksum text,
  ADD COLUMN is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN last_synced_at timestamptz;

UPDATE public.legal_documents
SET
  slug = COALESCE(
    NULLIF(metadata->>'slug', ''),
    trim(both '-' from regexp_replace(lower(external_id), '[^a-z0-9]+', '-', 'g'))
  ),
  source = CASE
    WHEN source_url ILIKE '%etalonline.by%' OR source_url ILIKE '%pravo.by%' THEN 'etalon'
    ELSE 'manual'
  END,
  category = CASE
    WHEN doc_type = 'code' OR title ILIKE '%кодекс%' THEN 'codes'
    ELSE 'acts'
  END,
  is_published = content_text IS NOT NULL AND btrim(content_text) <> ''
WHERE slug IS NULL;

ALTER TABLE public.legal_documents ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX legal_documents_slug_key
  ON public.legal_documents(slug);
CREATE UNIQUE INDEX legal_documents_source_external_id_key
  ON public.legal_documents(source, external_id);
CREATE INDEX legal_documents_category_published_idx
  ON public.legal_documents(category, is_published, title);

ALTER TABLE public.ilex_settings RENAME TO legislation_settings;
ALTER TABLE public.legislation_settings DROP COLUMN IF EXISTS session_cookie;
ALTER TABLE public.legislation_settings
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'etalon',
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_message text;

CREATE TABLE public.legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  revision_key text NOT NULL,
  revision_label text,
  effective_at date,
  content_text text NOT NULL,
  content_html text,
  structure jsonb NOT NULL DEFAULT '[]'::jsonb,
  checksum text NOT NULL,
  source_url text,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, revision_key)
);

CREATE UNIQUE INDEX legal_document_versions_one_current_idx
  ON public.legal_document_versions(document_id)
  WHERE is_current;

CREATE TABLE public.legal_anchor_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  old_anchor text NOT NULL,
  current_anchor text,
  status text NOT NULL DEFAULT 'redirect'
    CHECK (status IN ('redirect', 'removed', 'ambiguous')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, old_anchor)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_document_versions TO authenticated;
GRANT ALL ON public.legal_document_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_anchor_aliases TO authenticated;
GRANT SELECT ON public.legal_anchor_aliases TO anon;
GRANT ALL ON public.legal_anchor_aliases TO service_role;

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_anchor_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own ilex documents" ON public.legal_documents;
DROP POLICY IF EXISTS "Authenticated users can read all ilex documents" ON public.legal_documents;
DROP POLICY IF EXISTS "Users can insert their own ilex documents" ON public.legal_documents;
DROP POLICY IF EXISTS "Users can update their own ilex documents" ON public.legal_documents;
DROP POLICY IF EXISTS "Users can delete their own ilex documents" ON public.legal_documents;

CREATE POLICY "Registered users read published legislation"
  ON public.legal_documents FOR SELECT TO authenticated
  USING (
    is_published
    OR public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Editors insert legislation"
  ON public.legal_documents FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Editors update legislation"
  ON public.legal_documents FOR UPDATE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Editors delete legislation"
  ON public.legal_documents FOR DELETE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Registered users read published legislation versions"
  ON public.legal_document_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.legal_documents d
      WHERE d.id = document_id
        AND (
          d.is_published
          OR public.has_permission(auth.uid(), 'content.edit')
          OR public.is_super_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Editors manage legislation versions"
  ON public.legal_document_versions FOR ALL TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Registered users read legislation anchor aliases"
  ON public.legal_anchor_aliases FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.legal_documents d
      WHERE d.id = document_id AND d.is_published
    )
  );

CREATE POLICY "Editors manage legislation anchor aliases"
  ON public.legal_anchor_aliases FOR ALL TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admins can manage ilex settings" ON public.legislation_settings;
DROP POLICY IF EXISTS "Staff can read ilex settings" ON public.legislation_settings;
DROP POLICY IF EXISTS "Staff can update ilex settings" ON public.legislation_settings;
DROP POLICY IF EXISTS "Super admins can read ilex settings" ON public.legislation_settings;
DROP POLICY IF EXISTS "Super admins can update ilex settings" ON public.legislation_settings;
DROP POLICY IF EXISTS "Super admins can insert ilex settings" ON public.legislation_settings;

CREATE POLICY "Editors read legislation settings"
  ON public.legislation_settings FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Editors update legislation settings"
  ON public.legislation_settings FOR UPDATE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'content.edit')
    OR public.is_super_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.get_legal_document_preview(p_slug text)
RETURNS TABLE (
  slug text,
  title text,
  doc_type text,
  doc_date date,
  doc_number text,
  category text,
  status text,
  organ text,
  effective_at date,
  revision_label text,
  source_url text,
  last_synced_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.slug,
    d.title,
    d.doc_type,
    d.doc_date,
    d.doc_number,
    d.category,
    d.status,
    d.organ,
    d.effective_at,
    d.revision_label,
    d.source_url,
    d.last_synced_at
  FROM public.legal_documents d
  WHERE d.slug = p_slug
    AND d.is_published
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_legal_document_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_legal_document_preview(text) TO anon, authenticated;

UPDATE public.admin_section
SET
  code = 'legislation',
  label = 'Законодательство',
  route_prefix = '/admin/legislation'
WHERE code = 'ilex';

UPDATE public.news_sources
SET is_active = false
WHERE name = 'iLex Private' OR url ILIKE '%ilex-private.ilex.by%';

COMMENT ON TABLE public.legal_documents IS
  'Canonical legislation catalogue populated from ETALON-ONLINE or manual admin uploads.';
COMMENT ON TABLE public.legal_document_versions IS
  'Immutable full-text revisions of legislation documents.';
COMMENT ON TABLE public.legal_anchor_aliases IS
  'Redirects and tombstones preserving deep links after legislation revisions.';