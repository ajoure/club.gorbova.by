CREATE OR REPLACE FUNCTION public.get_legal_document_share_preview(p_ref text)
RETURNS TABLE (
  external_id text,
  slug text,
  title text,
  doc_type text,
  doc_date date,
  doc_number text,
  category text,
  status text,
  revision_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    document.external_id,
    document.slug,
    document.title,
    document.doc_type,
    document.doc_date,
    document.doc_number,
    document.category,
    document.status,
    document.revision_label
  FROM public.legal_documents AS document
  WHERE document.is_published
    AND (document.external_id = p_ref OR document.slug = p_ref)
  ORDER BY (document.external_id = p_ref) DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_legal_document_share_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_legal_document_share_preview(text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_legal_document_share_preview(text) IS
  'Returns publication-safe metadata for short legislation share links.';
