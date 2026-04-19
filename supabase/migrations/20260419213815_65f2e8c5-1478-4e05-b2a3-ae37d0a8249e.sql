-- PATCH: Storage RLS для admin upload в telegram-media
CREATE POLICY "Admins can upload to telegram-media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  )
);

CREATE POLICY "Admins can read telegram-media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  )
);

CREATE POLICY "Admins can update telegram-media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  )
);

CREATE POLICY "Admins can delete telegram-media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  )
);