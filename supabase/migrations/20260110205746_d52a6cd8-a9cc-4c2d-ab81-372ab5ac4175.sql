-- Drop old restrictive policy
DROP POLICY IF EXISTS "Admins can manage modules" ON public.training_modules;

-- Create new policy using user_roles table with correct role names
CREATE POLICY "Admins can manage modules" 
  ON public.training_modules FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );

-- Also fix training_lessons policy if needed
DROP POLICY IF EXISTS "Admins can manage lessons" ON public.training_lessons;

CREATE POLICY "Admins can manage lessons" 
  ON public.training_lessons FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );