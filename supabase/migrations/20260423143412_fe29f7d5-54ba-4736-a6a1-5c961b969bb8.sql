-- Safe-recreate RLS on public.payment_links to support both legacy admin and new super_admin
DROP POLICY IF EXISTS "Admins can manage payment links" ON public.payment_links;

CREATE POLICY "Admins can read payment links"
ON public.payment_links
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Admins can insert payment links"
ON public.payment_links
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Admins can update payment links"
ON public.payment_links
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

CREATE POLICY "Admins can delete payment links"
ON public.payment_links
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);