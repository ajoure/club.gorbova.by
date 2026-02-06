-- Fix RLS policy for system_health_reports to use correct roles table
DROP POLICY IF EXISTS "Superadmins can read system_health_reports" ON system_health_reports;

CREATE POLICY "Superadmins can read system_health_reports" 
ON system_health_reports 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_roles_v2 ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() 
    AND r.code = 'super_admin'
  )
);