UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT ARRAY(SELECT DISTINCT unnest(coalesce(allowed_mime_types, ARRAY[]::text[]) || ARRAY[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream'
  ]))
)
WHERE id = 'documents';