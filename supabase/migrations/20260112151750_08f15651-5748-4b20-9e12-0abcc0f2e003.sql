-- Create storage bucket for tariff media (welcome messages)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tariff-media',
  'tariff-media',
  false,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for tariff-media bucket
CREATE POLICY "Admins can upload tariff media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tariff-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can read tariff media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'tariff-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can delete tariff media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'tariff-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Service role needs access for edge functions
CREATE POLICY "Service role can access tariff media"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'tariff-media')
WITH CHECK (bucket_id = 'tariff-media');