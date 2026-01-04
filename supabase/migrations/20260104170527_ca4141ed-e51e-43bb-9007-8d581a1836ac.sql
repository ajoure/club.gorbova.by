-- Remove dangerous permissive UPDATE policy on orders table
DROP POLICY IF EXISTS "Service can update orders" ON public.orders;

-- Add admin-only UPDATE policy (uses has_permission function)
CREATE POLICY "Admins can update orders"
ON public.orders FOR UPDATE
USING (has_permission(auth.uid(), 'users.view'))
WITH CHECK (has_permission(auth.uid(), 'users.view'));

-- Add explicit DELETE policy for admins only
CREATE POLICY "Only admins can delete orders"
ON public.orders FOR DELETE
USING (has_permission(auth.uid(), 'users.view'));