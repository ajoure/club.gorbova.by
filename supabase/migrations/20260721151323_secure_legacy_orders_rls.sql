-- Lock the legacy orders table down to server-side writes.
-- Payment Edge Functions use service_role, so normal checkout remains unchanged.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Service can update orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Super admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Super admins can delete orders" ON public.orders;

-- Browser roles must never create legacy orders or perform table-level operations.
-- All order creation and payment status updates go through trusted Edge Functions.
REVOKE ALL PRIVILEGES ON TABLE public.orders FROM anon;
REVOKE INSERT, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.orders FROM authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.orders TO authenticated;

CREATE POLICY "Users can view their own orders"
ON public.orders
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.has_permission((SELECT auth.uid()), 'users.view'));

CREATE POLICY "Super admins can update orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (public.is_super_admin((SELECT auth.uid())))
WITH CHECK (public.is_super_admin((SELECT auth.uid())));

CREATE POLICY "Super admins can delete orders"
ON public.orders
FOR DELETE
TO authenticated
USING (public.is_super_admin((SELECT auth.uid())));
