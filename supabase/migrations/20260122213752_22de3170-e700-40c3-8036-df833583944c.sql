-- PATCH A: Create telegram-media bucket with proper MIME types for inbound media
-- Root cause: 'documents' bucket only allows application/pdf, causing 415 errors for images

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'telegram-media',
  'telegram-media',
  false,  -- private bucket, requires signed URL
  52428800,  -- 50MB limit
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/wav',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Service role has full access (webhook uses service key)
CREATE POLICY "Service role full access to telegram-media"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'telegram-media')
WITH CHECK (bucket_id = 'telegram-media');