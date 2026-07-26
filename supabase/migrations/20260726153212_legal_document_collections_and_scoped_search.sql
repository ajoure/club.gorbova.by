-- Reusable thematic collections. A document is stored once and may appear in
-- several catalog blocks through the join table.
CREATE TABLE public.legal_document_collections (
  code text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_document_collection_items (
  collection_code text NOT NULL
    REFERENCES public.legal_document_collections(code) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_code, document_id)
);

CREATE INDEX legal_document_collection_items_document_idx
  ON public.legal_document_collection_items(document_id, collection_code);

ALTER TABLE public.legal_document_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_collection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Registered users read legislation collections"
  ON public.legal_document_collections
  FOR SELECT TO authenticated
  USING (is_active);

CREATE POLICY "Registered users read published collection items"
  ON public.legal_document_collection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.legal_documents document
      WHERE document.id = document_id
        AND document.is_published
    )
  );

GRANT SELECT ON public.legal_document_collections TO authenticated;
GRANT SELECT ON public.legal_document_collection_items TO authenticated;
GRANT ALL ON public.legal_document_collections TO service_role;
GRANT ALL ON public.legal_document_collection_items TO service_role;

INSERT INTO public.legal_document_collections (code, title, description, sort_order)
VALUES
  (
    'accountant',
    'Главному бухгалтеру',
    'Бухгалтерский учет, отчетность, налоги и первичные документы',
    20
  ),
  (
    'director',
    'Руководителю',
    'Корпоративное управление и основные правила ведения бизнеса',
    30
  ),
  (
    'document_workflow',
    'Документооборот и делопроизводство',
    'Создание, оформление, подписание, хранение и архивирование документов',
    40
  )
ON CONFLICT (code) DO UPDATE
SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

-- Morphology-aware search constrained to one open document. The Russian text
-- search configuration stems inflected forms; an article number receives an
-- extra exact-match boost.
CREATE OR REPLACE FUNCTION public.search_legal_document(
  p_document_id uuid,
  p_query text,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  document_id uuid,
  anchor text,
  kind text,
  snippet text,
  full_text text,
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
  requested_article text;
BEGIN
  IF p_document_id IS NULL OR char_length(normalized_query) < 2 THEN
    RETURN;
  END IF;

  SELECT (regexp_match(
    lower(normalized_query),
    '(?:статья|ст\.?)\s*([0-9]+(?:[.-][0-9]+)*)'
  ))[1]
  INTO requested_article;

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
    chunk.document_id,
    chunk.anchor,
    chunk.kind,
    ts_headline(
      'russian',
      chunk.text,
      COALESCE(prefix_query, web_query),
      'StartSel=<mark>, StopSel=</mark>, MaxWords=38, MinWords=14, ShortWord=2, HighlightAll=false'
    ),
    chunk.text,
    (
      ts_rank_cd(chunk.search_vector, COALESCE(prefix_query, web_query))
      + CASE
          WHEN requested_article IS NOT NULL
            AND chunk.anchor = 'art-' || replace(requested_article, '.', '-')
          THEN 3
          WHEN requested_article IS NOT NULL
            AND chunk.anchor LIKE 'art-' || replace(requested_article, '.', '-') || '-%'
          THEN 1.5
          ELSE 0
        END
      + CASE
          WHEN chunk.text ILIKE '%' || normalized_query || '%' THEN 0.35
          ELSE 0
        END
    )::real
  FROM public.legal_document_search_chunks chunk
  JOIN public.legal_documents document ON document.id = chunk.document_id
  WHERE chunk.document_id = p_document_id
    AND document.is_published
    AND (
      (prefix_query IS NOT NULL AND chunk.search_vector @@ prefix_query)
      OR chunk.search_vector @@ web_query
      OR chunk.text ILIKE '%' || normalized_query || '%'
      OR (
        requested_article IS NOT NULL
        AND (
          chunk.anchor = 'art-' || replace(requested_article, '.', '-')
          OR chunk.anchor LIKE 'art-' || replace(requested_article, '.', '-') || '-%'
        )
      )
    )
  ORDER BY 6 DESC, chunk.ordinal
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.search_legal_document(uuid, text, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_legal_document(uuid, text, integer)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.search_legal_document(uuid, text, integer)
  TO authenticated;

COMMENT ON TABLE public.legal_document_collections IS
  'Reusable catalog blocks for legislation; documents are not duplicated.';
COMMENT ON FUNCTION public.search_legal_document(uuid, text, integer) IS
  'Russian morphology-aware paragraph search limited to one published legal document.';

CREATE OR REPLACE FUNCTION public.get_legal_document_collections()
RETURNS TABLE (
  collection_code text,
  collection_title text,
  collection_description text,
  collection_sort_order integer,
  document_sort_order integer,
  document_id uuid,
  external_id text,
  slug text,
  title text,
  doc_type text,
  doc_date date,
  doc_number text,
  category text,
  status text,
  last_synced_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    collection.code,
    collection.title,
    collection.description,
    collection.sort_order,
    item.sort_order,
    document.id,
    document.external_id,
    document.slug,
    document.title,
    document.doc_type,
    document.doc_date,
    document.doc_number,
    document.category,
    document.status,
    document.last_synced_at
  FROM public.legal_document_collections collection
  JOIN public.legal_document_collection_items item
    ON item.collection_code = collection.code
  JOIN public.legal_documents document
    ON document.id = item.document_id
  WHERE collection.is_active
    AND document.is_published
  ORDER BY
    collection.sort_order,
    collection.title,
    item.sort_order,
    document.title;
$$;

REVOKE ALL ON FUNCTION public.get_legal_document_collections() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_legal_document_collections() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_legal_document_collections()
  TO authenticated;

COMMENT ON FUNCTION public.get_legal_document_collections() IS
  'Published legislation grouped into reusable catalog collections.';
