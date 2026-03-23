UPDATE storage.buckets
SET allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
WHERE id = 'documents';