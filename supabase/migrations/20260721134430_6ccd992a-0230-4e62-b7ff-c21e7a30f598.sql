-- Canonical site-page slugs with durable aliases for previous URLs.
-- One page remains the source of truth; aliases only resolve old paths.

CREATE TABLE public.site_page_slug_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_page_id uuid NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT site_page_slug_aliases_slug_format
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

CREATE INDEX site_page_slug_aliases_page_id_idx
  ON public.site_page_slug_aliases(site_page_id);

ALTER TABLE public.site_page_slug_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_page_slug_aliases_public_select"
  ON public.site_page_slug_aliases
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.site_pages
      WHERE site_pages.id = site_page_slug_aliases.site_page_id
        AND site_pages.status = 'published'
    )
  );

CREATE POLICY "site_page_slug_aliases_admin_select"
  ON public.site_page_slug_aliases
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

CREATE POLICY "site_page_slug_aliases_admin_insert"
  ON public.site_page_slug_aliases
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

CREATE POLICY "site_page_slug_aliases_admin_delete"
  ON public.site_page_slug_aliases
  FOR DELETE
  TO authenticated
  USING (
    public.has_role_v2((SELECT auth.uid()), 'admin')
    OR public.has_role_v2((SELECT auth.uid()), 'super_admin')
  );

GRANT SELECT ON public.site_page_slug_aliases TO anon, authenticated;
GRANT INSERT, DELETE ON public.site_page_slug_aliases TO authenticated;

CREATE OR REPLACE FUNCTION public.preserve_site_page_slug_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  conflicting_page_id uuid;
BEGIN
  SELECT site_page_id
    INTO conflicting_page_id
  FROM public.site_page_slug_aliases
  WHERE slug = NEW.slug
  LIMIT 1;

  IF conflicting_page_id IS NOT NULL AND conflicting_page_id <> NEW.id THEN
    RAISE EXCEPTION 'site_page_slug_reserved_by_alias: %', NEW.slug
      USING ERRCODE = '23505';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.slug IS DISTINCT FROM NEW.slug THEN
    -- Reverting to an earlier canonical slug removes its redundant alias.
    DELETE FROM public.site_page_slug_aliases
    WHERE slug = NEW.slug AND site_page_id = NEW.id;

    INSERT INTO public.site_page_slug_aliases (site_page_id, slug, created_by)
    VALUES (OLD.id, OLD.slug, (SELECT auth.uid()))
    ON CONFLICT (slug) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_preserve_site_page_slug_alias
  BEFORE INSERT OR UPDATE OF slug ON public.site_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_site_page_slug_alias();

-- Requested canonical URL for PRD-000037. The trigger preserves the old path.
DO $$
DECLARE
  target_page_id uuid;
BEGIN
  SELECT sp.id
    INTO target_page_id
  FROM public.site_pages sp
  JOIN public.products_v2 p ON p.id = sp.product_id
  WHERE p.public_id = 'PRD-000037'
    AND sp.slug = 'ideologicheskaya-rabota'
  LIMIT 1;

  IF target_page_id IS NULL THEN
    RAISE EXCEPTION 'Expected published page ideologicheskaya-rabota for PRD-000037';
  END IF;

  IF EXISTS (SELECT 1 FROM public.site_pages WHERE slug = 'ir' AND id <> target_page_id)
     OR EXISTS (SELECT 1 FROM public.site_page_slug_aliases WHERE slug = 'ir' AND site_page_id <> target_page_id) THEN
    RAISE EXCEPTION 'Cannot assign /ir: slug is already in use';
  END IF;

  UPDATE public.site_pages
  SET slug = 'ir', updated_at = now()
  WHERE id = target_page_id;

  UPDATE public.products_v2
  SET primary_domain = NULL, updated_at = now()
  WHERE public_id = 'PRD-000037'
    AND primary_domain ~* '^https?://gorbova\.by/';
END;
$$;