-- Student homework must never be stored in the public training-assets bucket.
-- New files are written to this private bucket and served only by the
-- authenticated training-assets-download Edge Function.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('student-submissions', 'student-submissions', false, 524288000)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "Students upload own submissions" ON storage.objects;
CREATE POLICY "Students upload own submissions"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Required for resumable TUS uploads when a client resumes an interrupted file.
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

-- No direct SELECT policy: downloads run through the owner/admin checked Edge Function.
