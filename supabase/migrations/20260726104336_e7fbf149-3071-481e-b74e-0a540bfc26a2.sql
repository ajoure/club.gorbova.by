DROP POLICY IF EXISTS "student_uploads_insert" ON storage.objects;
DROP POLICY IF EXISTS "student_uploads_admin_select" ON storage.objects;

DROP POLICY IF EXISTS "Students read own submissions for resumable upload" ON storage.objects;
CREATE POLICY "Students read own submissions for resumable upload"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );