-- Remove dev-path logoUrl from already-inserted footer blocks so renderer falls back to bundled runtime asset via defaults merge
UPDATE site_pages
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'footer'
        AND block #>> '{content,brand,logoUrl}' LIKE '/src/assets/%'
      THEN jsonb_set(block, '{content,brand,logoUrl}', '""'::jsonb)
      ELSE block
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(block, ord)
)
WHERE slug IN ('consultation', 'consultation-copy')
  AND blocks @> '[{"type":"footer"}]'::jsonb;