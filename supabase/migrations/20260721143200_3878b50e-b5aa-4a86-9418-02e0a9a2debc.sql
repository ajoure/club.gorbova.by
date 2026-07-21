
CREATE POLICY "Live event media objects deletable by admins"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'live-event-media'
  AND (
    public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'super_admin')
  )
);
