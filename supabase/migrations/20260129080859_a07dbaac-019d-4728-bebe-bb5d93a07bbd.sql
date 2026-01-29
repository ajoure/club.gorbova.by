-- =====================================================
-- FIX: profiles table - restrict SELECT to authenticated users only
-- =====================================================

-- Drop the existing policy that allows public role
DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;

-- Create new policy that explicitly requires authenticated role
CREATE POLICY "Users can view profiles" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (
  (user_id = auth.uid()) 
  OR public.has_permission(auth.uid(), 'users.view')
);

-- =====================================================
-- FIX: bepaid_statement_rows table - restrict all access to admins only
-- =====================================================

-- Drop existing policies that use public role
DROP POLICY IF EXISTS "Admins can read bepaid_statement_rows" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Admins can view bePaid statements" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Admins can insert bepaid_statement_rows" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Admins can update bepaid_statement_rows" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Admins can delete bepaid_statement_rows" ON public.bepaid_statement_rows;

-- Create new policies with authenticated role requirement
CREATE POLICY "Admins can read bepaid_statement_rows" 
ON public.bepaid_statement_rows 
FOR SELECT 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert bepaid_statement_rows" 
ON public.bepaid_statement_rows 
FOR INSERT 
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update bepaid_statement_rows" 
ON public.bepaid_statement_rows 
FOR UPDATE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete bepaid_statement_rows" 
ON public.bepaid_statement_rows 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));