DROP POLICY IF EXISTS "Admins can view verification_jobs" ON public.payment_method_verification_jobs;
DROP POLICY IF EXISTS "Admins can insert verification_jobs" ON public.payment_method_verification_jobs;
DROP POLICY IF EXISTS "Admins can update verification_jobs" ON public.payment_method_verification_jobs;

CREATE POLICY "Admins can view verification_jobs"
ON public.payment_method_verification_jobs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Admins can insert verification_jobs"
ON public.payment_method_verification_jobs
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Admins can update verification_jobs"
ON public.payment_method_verification_jobs
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);