-- Fix RLS for admin_menu_settings: use existing role system via public.has_role()

-- Remove older/duplicate policies (both naming variants)
DROP POLICY IF EXISTS "Superadmins can view menu settings" ON public.admin_menu_settings;
DROP POLICY IF EXISTS "Superadmins can update menu settings" ON public.admin_menu_settings;
DROP POLICY IF EXISTS "Superadmins can insert menu settings" ON public.admin_menu_settings;

DROP POLICY IF EXISTS "Super admins can view menu settings" ON public.admin_menu_settings;
DROP POLICY IF EXISTS "Super admins can update menu settings" ON public.admin_menu_settings;
DROP POLICY IF EXISTS "Super admins can insert menu settings" ON public.admin_menu_settings;

-- Recreate policies bound to authenticated users and the shared role-check function
CREATE POLICY "Superadmins can view menu settings"
ON public.admin_menu_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can update menu settings"
ON public.admin_menu_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can insert menu settings"
ON public.admin_menu_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'superadmin'::app_role));
