CREATE POLICY "Global available packages visible to authenticated"
  ON public.document_package_templates
  FOR SELECT
  TO authenticated
  USING (
    profile_id IS NULL
    AND is_active = true
    AND is_available_to_all = true
  );