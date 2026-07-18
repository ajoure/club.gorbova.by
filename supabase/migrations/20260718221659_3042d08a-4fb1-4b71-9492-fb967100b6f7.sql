-- SECURITY-HOTFIX: сузить RLS на legacy public.orders
-- UPDATE/DELETE: только super_admin (или service_role — bypass RLS).
-- SELECT/INSERT — не трогаем.

DROP POLICY IF EXISTS "Only admins can delete orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;

CREATE POLICY "Super admins can update orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete orders"
ON public.orders
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));
