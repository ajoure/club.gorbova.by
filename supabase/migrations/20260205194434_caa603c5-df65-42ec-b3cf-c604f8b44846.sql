-- Allow admins and superadmins to read all lesson progress records
CREATE POLICY "Admins can read all progress state"
ON public.lesson_progress_state
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'superadmin')
  )
);