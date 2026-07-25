-- Paragraph-level search index for legislation. Each result keeps the stable
-- document anchor so the UI can open the exact provision that matched.

CREATE TABLE public.legal_document_search_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL
    REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  anchor text NOT NULL,
  ordinal integer NOT NULL,
  kind text NOT NULL DEFAULT 'paragraph',
  text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('russian', coalesce(text, ''))
  ) STORED,
  UNIQUE (document_id, anchor)
);

CREATE INDEX legal_document_search_chunks_document_idx
  ON public.legal_document_search_chunks(document_id, ordinal);

CREATE INDEX legal_document_search_chunks_fts_idx
  ON public.legal_document_search_chunks USING gin(search_vector);

ALTER TABLE public.legal_document_search_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Registered users search published legislation"
  ON public.legal_document_search_chunks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.legal_documents document
      WHERE document.id = document_id
        AND document.is_published
    )
  );

GRANT SELECT ON public.legal_document_search_chunks TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.refresh_legal_document_search_chunks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.legal_document_search_chunks
  WHERE document_id = NEW.id;

  INSERT INTO public.legal_document_search_chunks (
    document_id,
    anchor,
    ordinal,
    kind,
    text
  )
  SELECT
    NEW.id,
    COALESCE(NULLIF(node.id, ''), 'par-' || node.ordinality),
    node.ordinality::integer,
    COALESCE(NULLIF(node.kind, ''), 'paragraph'),
    btrim(node.text)
  FROM jsonb_to_recordset(
    CASE
      WHEN jsonb_typeof(NEW.structure) = 'array' THEN NEW.structure
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS node(
    id text,
    kind text,
    text text,
    level integer,
    ordinality bigint
  )
  WHERE btrim(COALESCE(node.text, '')) <> ''
  ON CONFLICT (document_id, anchor) DO UPDATE
  SET
    ordinal = EXCLUDED.ordinal,
    kind = EXCLUDED.kind,
    text = EXCLUDED.text;

  RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_legal_document_search_chunks
AFTER INSERT OR UPDATE OF structure ON public.legal_documents
FOR EACH ROW
EXECUTE FUNCTION private.refresh_legal_document_search_chunks();

REVOKE ALL ON FUNCTION private.refresh_legal_document_search_chunks() FROM PUBLIC;

-- Backfill all documents imported before this migration.
INSERT INTO public.legal_document_search_chunks (
  document_id,
  anchor,
  ordinal,
  kind,
  text
)
SELECT
  document.id,
  COALESCE(NULLIF(node.id, ''), 'par-' || node.ordinality),
  node.ordinality::integer,
  COALESCE(NULLIF(node.kind, ''), 'paragraph'),
  btrim(node.text)
FROM public.legal_documents document
CROSS JOIN LATERAL jsonb_to_recordset(
  CASE
    WHEN jsonb_typeof(document.structure) = 'array' THEN document.structure
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS node(
  id text,
  kind text,
  text text,
  level integer,
  ordinality bigint
)
WHERE btrim(COALESCE(node.text, '')) <> ''
ON CONFLICT (document_id, anchor) DO UPDATE
SET
  ordinal = EXCLUDED.ordinal,
  kind = EXCLUDED.kind,
  text = EXCLUDED.text;

CREATE OR REPLACE FUNCTION public.search_legal_documents(
  p_query text,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  document_id uuid,
  slug text,
  title text,
  category text,
  status text,
  doc_date date,
  doc_number text,
  anchor text,
  kind text,
  snippet text,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized_query text := btrim(COALESCE(p_query, ''));
  prefix_query tsquery;
  web_query tsquery;
BEGIN
  IF char_length(normalized_query) < 2 THEN
    RETURN;
  END IF;

  SELECT to_tsquery(
    'russian',
    string_agg(token || ':*', ' & ')
  )
  INTO prefix_query
  FROM regexp_split_to_table(
    regexp_replace(lower(normalized_query), '[^[:alnum:]а-яё]+', ' ', 'g'),
    '\s+'
  ) AS token
  WHERE char_length(token) > 1;

  web_query := websearch_to_tsquery('russian', normalized_query);

  RETURN QUERY
  SELECT
    document.id,
    document.slug,
    document.title,
    document.category,
    document.status,
    document.doc_date,
    document.doc_number,
    chunk.anchor,
    chunk.kind,
    ts_headline(
      'russian',
      CASE
        WHEN document.title ILIKE '%' || normalized_query || '%'
          AND NOT (
            (prefix_query IS NOT NULL AND chunk.search_vector @@ prefix_query)
            OR chunk.search_vector @@ web_query
            OR chunk.text ILIKE '%' || normalized_query || '%'
          )
        THEN document.title
        ELSE chunk.text
      END,
      COALESCE(prefix_query, web_query),
      'StartSel=<mark>, StopSel=</mark>, MaxWords=34, MinWords=12, ShortWord=2, HighlightAll=false'
    ),
    (
      ts_rank_cd(chunk.search_vector, COALESCE(prefix_query, web_query))
      + CASE
          WHEN document.title ILIKE '%' || normalized_query || '%' THEN 0.75
          ELSE 0
        END
    )::real AS rank
  FROM public.legal_document_search_chunks chunk
  JOIN public.legal_documents document ON document.id = chunk.document_id
  WHERE document.is_published
    AND (
      (prefix_query IS NOT NULL AND chunk.search_vector @@ prefix_query)
      OR chunk.search_vector @@ web_query
      OR chunk.text ILIKE '%' || normalized_query || '%'
      OR (
        document.title ILIKE '%' || normalized_query || '%'
        AND chunk.ordinal = 1
      )
    )
  ORDER BY rank DESC, document.title, chunk.ordinal
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.search_legal_documents(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_legal_documents(text, integer)
  TO authenticated;

COMMENT ON TABLE public.legal_document_search_chunks IS
  'Paragraph-level Russian full-text index with stable anchors for legislation.';
