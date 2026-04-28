DROP POLICY IF EXISTS "Admins can upload lesson training-assets" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update lesson training-assets" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete lesson training-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public can read training-assets" ON storage.objects;

CREATE POLICY "Admins can upload lesson training-assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'training-assets'
  AND (storage.foldername(name))[1] IN (
    'lesson-audio',
    'lesson-files',
    'lesson-images',
    'ai-covers',
    'training-covers',
    'lesson-covers'
  )
  AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
);

CREATE POLICY "Admins can update lesson training-assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'training-assets'
  AND (storage.foldername(name))[1] IN (
    'lesson-audio',
    'lesson-files',
    'lesson-images',
    'ai-covers',
    'training-covers',
    'lesson-covers'
  )
  AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
)
WITH CHECK (
  bucket_id = 'training-assets'
  AND (storage.foldername(name))[1] IN (
    'lesson-audio',
    'lesson-files',
    'lesson-images',
    'ai-covers',
    'training-covers',
    'lesson-covers'
  )
  AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
);

CREATE POLICY "Admins can delete lesson training-assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'training-assets'
  AND (storage.foldername(name))[1] IN (
    'lesson-audio',
    'lesson-files',
    'lesson-images',
    'ai-covers',
    'training-covers',
    'lesson-covers'
  )
  AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
);

CREATE POLICY "Public can read training-assets"
ON storage.objects
FOR SELECT
USING (bucket_id = 'training-assets');