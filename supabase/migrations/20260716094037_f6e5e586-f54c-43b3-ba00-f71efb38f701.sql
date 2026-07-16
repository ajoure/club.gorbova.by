-- Remove broad SELECT for all authenticated users. Only the existing
-- "Admins can manage executors" ALL policy (admin/super_admin) remains.
DROP POLICY IF EXISTS "Authenticated users can view active executors" ON public.executors;

-- Belt-and-suspenders: ensure anon has no access to executors table
REVOKE ALL ON public.executors FROM anon;