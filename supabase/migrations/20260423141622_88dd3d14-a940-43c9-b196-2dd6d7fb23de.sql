CREATE POLICY "Admins can view verification_jobs"
ON public.payment_method_verification_jobs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'superadmin'::app_role)
);

CREATE POLICY "Admins can insert verification_jobs"
ON public.payment_method_verification_jobs
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'superadmin'::app_role)
);

CREATE POLICY "Admins can update verification_jobs"
ON public.payment_method_verification_jobs
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'superadmin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'superadmin'::app_role)
);