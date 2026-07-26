-- Complete the student-upload isolation rollout.
--
-- The older policies below target the public `training-assets` bucket.  Leaving
-- them enabled means a client can still place a student submission under
-- `student-uploads/<user_id>/...` where it receives a public object URL.
-- New submissions must use only the private `student-submissions` bucket.

DROP POLICY IF EXISTS "student_uploads_insert" ON storage.objects;
DROP POLICY IF EXISTS "student_uploads_admin_select" ON storage.objects;

-- Resumable TUS upload checks an existing object before it continues an
-- interrupted upload.  This narrow SELECT policy is therefore necessary for
-- the owner only; it does not grant access to another student's files.
DROP POLICY IF EXISTS "Students read own submissions for resumable upload" ON storage.objects;
CREATE POLICY "Students read own submissions for resumable upload"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = 'student-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Migration of existing objects is deliberately performed by the guarded
-- `admin-migrate-student-submissions` Edge Function, in small resumable
-- batches.  It copies first, updates database metadata, and only then removes
-- the public source object.
