CREATE POLICY "Admins can delete submissions"
ON public.site_form_submissions
FOR DELETE
TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);