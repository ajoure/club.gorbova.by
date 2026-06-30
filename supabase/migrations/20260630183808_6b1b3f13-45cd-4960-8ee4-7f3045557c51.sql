
-- PATCH: Telegram-media bucket RLS — поддержка ролей has_role_v2 (admin, super_admin, menedzher, support, editor)
-- Root cause: старые policies проверяли только legacy has_role(admin|superadmin), из-за чего 
-- пользователи с ролями v2 (super_admin, menedzher и т.д.) получали 403 при загрузке файлов в
-- Telegram-чат контакт-центра (включая Word-файлы).

DROP POLICY IF EXISTS "Admins can upload to telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete telegram-media" ON storage.objects;

CREATE POLICY "Staff can upload to telegram-media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
  )
);

CREATE POLICY "Staff can read telegram-media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
  )
);

CREATE POLICY "Staff can update telegram-media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
  )
);

CREATE POLICY "Staff can delete telegram-media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
  )
);
