-- Fix RLS policies on course_preregistrations to use correct permission codes
-- Current policies use 'contacts.read' and 'contacts.manage' which don't exist
-- Available permissions are 'contacts.view' and 'contacts.edit'

-- Drop old policies with incorrect permission codes
DROP POLICY IF EXISTS "Admins can view all preregistrations" ON course_preregistrations;
DROP POLICY IF EXISTS "Admins can manage preregistrations" ON course_preregistrations;

-- Create policies with correct permission codes
CREATE POLICY "Admins can view all preregistrations" 
ON course_preregistrations FOR SELECT 
USING (has_permission(auth.uid(), 'contacts.view'));

CREATE POLICY "Admins can manage preregistrations" 
ON course_preregistrations FOR ALL 
USING (has_permission(auth.uid(), 'contacts.edit'));