DROP POLICY IF EXISTS "Students upload own submissions" ON storage.objects;
CREATE POLICY "Students upload own submissions"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Students update own submissions" ON storage.objects;
CREATE POLICY "Students update own submissions"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );